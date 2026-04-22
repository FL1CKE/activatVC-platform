const page = document.body.dataset.page;

const STATUS_LABELS = {
  submitted: 'отправлена',
  awaiting_founder: 'ожидает фаундера',
  ready_for_analysis: 'готова к анализу',
  analyzing: 'в анализе',
  complete: 'завершена',
  open: 'открыт',
  resolved: 'закрыт',
  pending: 'в очереди',
  completed: 'завершен',
};

const GAP_SOURCE_LABELS = {
  prepare: 'проверка комплекта',
  agent_request: 'запрос агента',
};

const GAP_TYPE_LABELS = {
  critical: 'критично',
  recommended: 'рекомендуется',
};

const CATEGORY_LABELS = {
  business: 'бизнес',
  financial: 'финансы',
  team: 'команда',
  technical: 'технологии',
  legal: 'юридическое',
  general: 'общее',
  product: 'продукт',
};

const STAGE_LABELS = {
  'pre-seed': 'pre-seed',
  seed: 'seed',
};

const VERDICT_LABELS = {
  INVEST: 'инвестировать',
  CONDITIONAL: 'условно положительно',
  WATCH: 'наблюдать',
  'PASS WITH FB': 'отказать с обратной связью',
  PASS: 'отказать',
};

function translateStatus(value) {
  return STATUS_LABELS[value] || value || 'нет';
}

function translateGapSource(value) {
  return GAP_SOURCE_LABELS[value] || value || 'нет';
}

function translateGapType(value) {
  return GAP_TYPE_LABELS[value] || value || 'нет';
}

function translateCategory(value) {
  return CATEGORY_LABELS[value] || value || 'общее';
}

function translateStage(value) {
  return STAGE_LABELS[value] || value || 'не указана';
}

function translateVerdict(value) {
  return VERDICT_LABELS[value] || value || 'нет';
}

function translateEventType(value) {
  if (!value) return 'событие';
  const labels = {
    'submission.created': 'заявка создана',
    'submission.updated': 'заявка обновлена',
    'prepare.completed': 'проверка комплекта завершена',
    'prepare.awaiting_founder': 'ожидание материалов от фаундера',
    'prepare.ready': 'заявка готова к анализу',
    'magic.responded': 'фаундер прислал ответ',
    'founder.responded': 'фаундер прислал ответ',
    'analysis.started': 'анализ запущен',
    'agent.completed': 'агент завершил обработку',
    'agent.response': 'агент завершил обработку',
    'agent.requested_more_info': 'агент запросил дополнительные материалы',
    'analysis.awaiting_founder': 'агент запросил дополнительные материалы',
    'aggregate.completed': 'итоговый отчет сформирован',
  };
  return labels[value] || value;
}

function createFounderCard(index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'founder-card';
  wrapper.innerHTML = `
    <label>Имя фаундера<input data-founder="name" placeholder="Фаундер ${index + 1}" /></label>
    <label>Страна<input data-founder="country" placeholder="Страна" /></label>
    <label>Гражданство<input data-founder="citizenship" placeholder="Гражданство" /></label>
    <label>Профили через запятую<input data-founder="profiles" placeholder="LinkedIn, X, GitHub" /></label>
  `;
  return wrapper;
}

function founderPayloadFromDom() {
  return Array.from(document.querySelectorAll('#founders-list > div')).map((card) => ({
    name: card.querySelector('[data-founder="name"]').value,
    country: card.querySelector('[data-founder="country"]').value,
    citizenship: card.querySelector('[data-founder="citizenship"]').value,
    profiles: card.querySelector('[data-founder="profiles"]').value.split(',').map((value) => value.trim()).filter(Boolean),
  })).filter((founder) => founder.name);
}

async function setupIntakePage() {
  const foundersList = document.getElementById('founders-list');
  const addFounderButton = document.getElementById('add-founder');
  const form = document.getElementById('submission-form');
  const result = document.getElementById('submission-result');

  foundersList.appendChild(createFounderCard(0));
  addFounderButton.addEventListener('click', () => foundersList.appendChild(createFounderCard(foundersList.children.length)));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    formData.set('founders', JSON.stringify(founderPayloadFromDom()));

    const response = await fetch('/api/applications', { method: 'POST', body: formData });
    const data = await response.json();
    result.classList.remove('hidden');
    result.textContent = JSON.stringify(data, null, 2);
  });
}

function renderGap(gap) {
  return `
    <article class="guide-item">
      <div class="card-title-row">
        <h3>${gap.title}</h3>
        <span class="status-pill">${translateGapSource(gap.source)} / ${translateGapType(gap.gapType)} / ${translateStatus(gap.status)}</span>
      </div>
      <p class="note">${gap.description}</p>
      <p>${gap.question}</p>
    </article>
  `;
}

function renderAgentRun(run) {
  return `
    <article class="guide-item">
      <div class="card-title-row">
        <h3>${run.agentName}</h3>
        <span class="status-pill">раунд ${run.round} / ${translateStatus(run.status)}</span>
      </div>
      <p class="note">Оценка: ${run.score ?? 'нет'}</p>
      <details>
        <summary>Тело запроса</summary>
        <pre class="result-box">${JSON.stringify(run.requestPayload, null, 2)}</pre>
      </details>
      <details>
        <summary>Тело ответа</summary>
        <pre class="result-box">${JSON.stringify(run.responsePayload, null, 2)}</pre>
      </details>
    </article>
  `;
}

function renderApplicationList(applications) {
  const list = document.getElementById('applications-list');
  list.innerHTML = applications.map((app) => `
    <button class="application-card" data-id="${app.id}">
      <div class="card-title-row">
        <strong>${app.startupName}</strong>
        <span class="status-pill">${translateStatus(app.status)}</span>
      </div>
      <p class="note">${translateStage(app.startupStage)} • ${app.openGapCount} открытых пробелов • ${app.agentRunCount} запусков агентов</p>
      <div class="meta-row">
        <span class="status-pill">${app.documents.length} документов</span>
        <span class="status-pill">оценка ${app.investmentScore ?? 'нет'}</span>
      </div>
    </button>
  `).join('');

  list.querySelectorAll('[data-id]').forEach((node) => {
    node.addEventListener('click', () => loadApplicationDetail(node.dataset.id));
  });
}

async function loadDashboard() {
  const response = await fetch('/api/applications');
  const data = await response.json();
  renderApplicationList(data);
}

async function loadApplicationDetail(id) {
  const response = await fetch(`/api/applications/${id}`);
  const application = await response.json();
  const detail = document.getElementById('application-detail');
  const aggregateResponse = await fetch(`/api/applications/${id}/aggregate`);
  const aggregate = await aggregateResponse.json();

  detail.classList.remove('empty-state');
  detail.innerHTML = `
    <article class="guide-item">
      <div class="card-title-row">
        <h3>${application.startupName}</h3>
        <span class="status-pill">${translateStatus(application.status)}</span>
      </div>
      <p class="note">Ссылка для фаундера: ${application.magicLinkUrl ? `<a href="${application.magicLinkUrl}" target="_blank">открыть портал</a>` : 'нет'}</p>
      <div class="meta-row">
        <span class="status-pill">стадия ${translateStage(application.startupStage)}</span>
        <span class="status-pill">оценка ${application.investmentScore ?? 'нет'}</span>
        <span class="status-pill">вердикт ${translateVerdict(application.verdict)}</span>
      </div>
    </article>
    <section>
      <h3>Открытые и закрытые пробелы</h3>
      <div class="detail-stack">${application.gapItems.map(renderGap).join('') || '<p class="note">Пока пробелов нет.</p>'}</div>
    </section>
    <section>
      <h3>Загруженные документы</h3>
      <div class="detail-stack">${application.documents.map((doc) => `
        <article class="guide-item">
          <div class="card-title-row"><strong>${doc.originalName}</strong><span class="status-pill">${translateCategory(doc.category)}</span></div>
          <p class="note">${doc.summary || 'Без описания'}</p>
          <a href="${doc.fileUrl}" target="_blank">Открыть документ</a>
        </article>
      `).join('') || '<p class="note">Документы не загружены.</p>'}</div>
    </section>
    <section>
      <h3>Трафик агентов</h3>
      <div class="detail-stack">${application.agentRuns.map(renderAgentRun).join('') || '<p class="note">Запусков агентов пока нет.</p>'}</div>
    </section>
    <section>
      <h3>Итоговый результат</h3>
      <pre class="result-box">${aggregate ? JSON.stringify(aggregate, null, 2) : 'Итоговый отчет пока недоступен.'}</pre>
    </section>
    <section>
      <h3>Таймлайн</h3>
      <div class="detail-stack">${application.events.map((event) => `
        <article class="guide-item">
          <div class="card-title-row"><strong>${translateEventType(event.eventType)}</strong><span class="status-pill">${new Date(event.createdAt).toLocaleString('ru-RU')}</span></div>
          <p>${event.message}</p>
        </article>
      `).join('') || '<p class="note">Событий пока нет.</p>'}</div>
    </section>
  `;
}

async function setupDashboardPage() {
  await loadDashboard();
  document.getElementById('refresh-dashboard').addEventListener('click', loadDashboard);
}

function gapFieldMarkup(gap) {
  const textField = gap.inputType !== 'file'
    ? `<label>Ответ<textarea data-gap-id="${gap.id}" rows="3" placeholder="${gap.question}"></textarea></label>`
    : '';
  const fileField = gap.inputType !== 'text'
    ? `<label>Прикрепить файл<input type="file" name="gapDocument:${gap.id}" /></label>`
    : '';

  return `
    <article class="guide-item">
      <div class="card-title-row">
        <h3>${gap.title}</h3>
        <span class="status-pill">${translateGapType(gap.gapType)}</span>
      </div>
      <p class="note">${gap.question}</p>
      <div class="form-stack">${textField}${fileField}</div>
    </article>
  `;
}

async function setupMagicPage() {
  const token = window.location.pathname.split('/').pop();
  const state = document.getElementById('magic-state');
  const form = document.getElementById('magic-form');
  const result = document.getElementById('magic-result');

  const response = await fetch(`/api/magic/${token}`);
  const application = await response.json();

  state.innerHTML = `
    <article class="guide-item">
      <div class="card-title-row">
        <h2>${application.startupName}</h2>
        <span class="status-pill">${translateStatus(application.status)}</span>
      </div>
      <p class="note">Используйте эту страницу только для ответов на открытые запросы.</p>
      <div class="meta-row">
        <span class="status-pill">${application.documents.length} документов загружено</span>
        <span class="status-pill">${application.openGapCount} открытых пробелов</span>
      </div>
    </article>
  `;

  const openGaps = application.gapItems.filter((gap) => gap.status === 'open');
  if (openGaps.length === 0) {
    form.classList.add('hidden');
    state.insertAdjacentHTML('beforeend', '<p class="note">Сейчас открытых запросов нет.</p>');
    return;
  }

  form.classList.remove('hidden');
  form.innerHTML = `${openGaps.map(gapFieldMarkup).join('')}<button class="button primary" type="submit">Отправить ответ</button>`;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const responses = {};
    form.querySelectorAll('[data-gap-id]').forEach((field) => {
      if (field.value.trim()) {
        responses[field.dataset.gapId] = field.value.trim();
      }
    });
    formData.set('responses', JSON.stringify(responses));

    const submitResponse = await fetch(`/api/magic/${token}/respond`, { method: 'POST', body: formData });
    const data = await submitResponse.json();
    result.classList.remove('hidden');
    result.textContent = JSON.stringify(data, null, 2);
  });
}

if (page === 'intake') {
  setupIntakePage();
} else if (page === 'dashboard') {
  setupDashboardPage();
} else if (page === 'magic') {
  setupMagicPage();
}
