"""
Парсер документов для агентов.

Агент получает bytes документа + mimeType → получает обратно plain text.
Это нужно чтобы передать содержимое документа в LLM как часть промпта.

Ограничение: LLM имеет context window. Большие документы обрезаем.
MAX_CHARS = 50_000 (~12K токенов) — достаточно для большинства pitch deck'ов.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_CHARS = 50_000  # обрезаем слишком длинные документы


def extract_text(content: bytes, mime_type: str, filename: str = "") -> str:
    """
    Главная функция. Определяет тип и вызывает нужный парсер.
    Никогда не бросает исключение — возвращает сообщение об ошибке как текст,
    чтобы агент мог сообщить что документ нечитаем.
    """
    mime_type = mime_type.lower().strip()
    filename_lower = filename.lower()

    try:
        if mime_type == "application/pdf" or filename_lower.endswith(".pdf"):
            text = _parse_pdf(content)
        elif mime_type in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        ) or filename_lower.endswith((".docx", ".doc")):
            text = _parse_docx(content)
        elif mime_type in ("text/markdown", "text/x-markdown") or filename_lower.endswith(".md"):
            text = _parse_markdown(content)
        elif mime_type.startswith("text/"):
            text = content.decode("utf-8", errors="replace")
        else:
            return f"[Unsupported format: {mime_type}. File: {filename}]"

        # Обрезаем если документ слишком большой
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS] + f"\n\n[... truncated at {MAX_CHARS} chars ...]"

        return text.strip()

    except Exception as e:
        logger.warning(f"Failed to parse document '{filename}' ({mime_type}): {e}")
        return f"[Failed to parse document: {filename}. Error: {str(e)}]"


def _parse_pdf(content: bytes) -> str:
    """PyMuPDF (fitz) — быстрый и надёжный, читает даже сканы (с OCR слоем)."""
    import fitz  # PyMuPDF

    text_parts = []
    with fitz.open(stream=content, filetype="pdf") as doc:
        for page_num, page in enumerate(doc, start=1):
            page_text = page.get_text("text")
            if page_text.strip():
                text_parts.append(f"[Page {page_num}]\n{page_text}")

    return "\n\n".join(text_parts)


def _parse_docx(content: bytes) -> str:
    """python-docx — читает параграфы и таблицы."""
    import io
    from docx import Document

    doc = Document(io.BytesIO(content))
    parts = []

    for element in doc.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            # Параграф
            from docx.oxml.ns import qn
            para_text = "".join(
                node.text or ""
                for node in element.iter()
                if node.tag == qn("w:t")
            )
            if para_text.strip():
                parts.append(para_text)

        elif tag == "tbl":
            # Таблица — конвертируем в markdown-подобный формат
            rows = []
            for row in element.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tr"):
                cells = []
                for cell in row.findall("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tc"):
                    cell_text = "".join(
                        node.text or ""
                        for node in cell.iter()
                        if node.tag == "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
                    )
                    cells.append(cell_text.strip())
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                parts.append("\n".join(rows))

    return "\n\n".join(parts)


def _parse_markdown(content: bytes) -> str:
    """MD файлы — просто декодируем, LLM прекрасно понимает markdown."""
    return content.decode("utf-8", errors="replace")
