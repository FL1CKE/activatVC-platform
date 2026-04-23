import { useState, useRef, useEffect, useCallback } from "react";
import { buildStartupPayload, triggerAnalysis, pollRunStatus } from "./api/platformApi.js";

// Dev: proxy через Vite → localhost:3001
// Production: VITE_CHAT_API_URL = https://your-chat.railway.app/api/chat
const API_URL = import.meta.env.VITE_CHAT_API_URL || "/api/chat";
const SC = { HOME:'home', FORM:'form', INVESTOR:'investor' };

const ICheck  = ({sz=14,col="#16a34a"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const IXc     = ({sz=14,col="#dc2626"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
const ISend   = ({sz=16,col="#fff"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IArrow  = ({sz=14,col="#1d4ed8"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
const IUpload = ({sz=22,col="#9ca3af"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="1.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>;
const IUser   = ({sz=16,col="#6b7280"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IX      = ({sz=14,col="#9ca3af"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IGlobe  = ({sz=13,col="#9ca3af"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
const IPlus   = ({sz=13,col="#1d4ed8"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IVideo  = ({sz=14,col="#7c3aed"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>;
const IShield = ({sz=14,col="#059669"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IKey    = ({sz=14,col="#d97706"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>;
const IChevD  = ({sz=16,col="currentColor"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>;
const IRocket = ({sz=18,col="#fff"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>;
const IStar   = ({sz=18,col="#fff"})=><svg width={sz} height={sz} viewBox="0 0 24 24" fill={col} stroke={col} strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;

const T={
  bg:'#EFF3F8',surface:'#FFFFFF',surfaceAlt:'#F5F5F7',
  border:'#E4E0D8',borderLight:'#EDE9E2',
  text:'#1A1714',textMuted:'#6B6560',textSubtle:'#9B9590',
  accent:'#1d6bfc',accentHover:'#1558e0',accentBg:'#EEF4FF',accentBorder:'#C5D9FF',
  green:'#16a34a',greenBg:'#F0FDF4',greenBorder:'#86efac',
  red:'#dc2626',redBg:'#FEF2F2',redBorder:'#fca5a5',
  amber:'#d97706',amberBg:'#FFFBEB',amberBorder:'#fcd34d',
  purple:'#7c3aed',purpleBg:'#F5F3FF',purpleBorder:'#c4b5fd',
};

const L={
  ru:{
    title:'Заявка на получение инвестиций',back:'← Назад',
    companySection:'Информация о компании',
    companySub:'Название, вид деятельности, запрашиваемые инвестиции',
    founderSection:'Заявитель (фаундер или один из фаундеров)',
    founderSub:'Информация о команде основателей',
    docSection:'Data room (Документы)',
    docSub:'Документы для due diligence',
    mandatory:'ОБЯЗАТЕЛЬНЫЕ',replace:'Заменить',upload:'Загрузить',
    founder:'Фаундер',name:'ФИО',country:'Страна',role:'Роль',
    linkType:'Тип ссылки',linkUrl:'Ссылка / профиль',addLink:'+ Добавить ссылку',
    details:'Подробнее',aiAssistant:'ИИ-ассистент фаундера',aiPlaceholder:'Напишите вопрос...',
    suggestQ1:'Что важно для pre-seed?',suggestQ2:'Как загрузить Demo?',
    siteCheck:'Gate Check пройден — все критерии',optional:'если есть',
    company:'Название компании',activity:'Вид деятельности',stage:'Стадия проекта',
    email:'Email',invest:'Запрашиваемые инвестиции',desc:'Описание проекта',
    site:'Сайт',chooseActivity:'Выберите вид деятельности',
    pitchDeck:'Pitch Deck',subdocLabel:'СУБДОКУМЕНТЫ К PITCH DECK',
    productDemo:'PRODUCT DEMO',productDemoSub:'Чем больше доступа — тем точнее оценка CPO+CTO',
    accessLabel:'Доступ к продукту',accessSub:'Ожидается для Seed',
    videoLabel:'Видео-демонстрация',videoSub:'5–15 мин',
    publicLink:'Ссылка на публичный продукт',publicLinkSub:'без регистрации',
    legalPack:'ЮРИДИЧЕСКИЙ ПАКЕТ',legalPackSub:'Условие закрытия сделки',
    finModel:'Финансовая модель',
    submitBtn:'Отправить на рассмотрение',submitSub:'Анализ 5–15 минут · Email придёт на почту',
    whatIs:'ЧТО ЭТО?',how:'КАК ПОДГОТОВИТЬ?',why:'ЗАЧЕМ ИНВЕСТОРУ?',
    aiSub:'Помогу заполнить заявку и отвечу на вопросы',
    firstRound:'1-й раунд',firstRoundDone:'✓ 1-й раунд',
    draftSaved:'Черновик автосохранён ✓',
    draftHint:'Почти готово! Загрузите документы в Data Room',
  },
  en:{
    title:'Investment Application',back:'← Back',
    companySection:'Company Information',
    companySub:'Name, activity, requested investment',
    founderSection:'Applicant (founder or one of the founders)',
    founderSub:'Information about the founding team',
    docSection:'Data room (Documents)',
    docSub:'Documents for due diligence',
    mandatory:'REQUIRED',replace:'Replace',upload:'Upload',
    founder:'Founder',name:'Full Name',country:'Country',role:'Role',
    linkType:'Link type',linkUrl:'Link / profile',addLink:'+ Add link',
    details:'Details',aiAssistant:'AI Assistant',aiPlaceholder:'Ask a question...',
    suggestQ1:'What matters for pre-seed?',suggestQ2:'How to upload Demo?',
    siteCheck:'Gate Check passed — all criteria met',optional:'if available',
    company:'Company Name',activity:'Business Activity',stage:'Project Stage',
    email:'Email',invest:'Requested Investment',desc:'Project Description',
    site:'Website',chooseActivity:'Choose activity',
    pitchDeck:'Pitch Deck',subdocLabel:'SUBDOCUMENTS TO PITCH DECK',
    productDemo:'PRODUCT DEMO',productDemoSub:'More access = more accurate CPO+CTO evaluation',
    accessLabel:'Product Access',accessSub:'Expected for Seed',
    videoLabel:'Video Demo',videoSub:'5–15 min',
    publicLink:'Public product link',publicLinkSub:'no registration',
    legalPack:'LEGAL PACKAGE',legalPackSub:'Required before closing',
    finModel:'Financial Model',
    submitBtn:'Submit for Review',submitSub:'Analysis 5–15 min · Results sent by email',
    whatIs:'WHAT IS IT?',how:'HOW TO PREPARE?',why:'WHY FOR INVESTOR?',
    aiSub:'I\'ll help you fill the form and answer questions',
    firstRound:'1st round',firstRoundDone:'✓ 1st round',
    draftSaved:'Draft auto-saved ✓',
    draftHint:'Almost done! Upload documents to Data Room',
  },
};

const CA=['Казахстан','Узбекистан','Кыргызстан','Таджикистан','Туркменистан'];
const BLOCKED=['крипто','блокчейн','web3','nft','токен','gambling','казино','crypto','blockchain','token','casino','deep-tech','deeptech'];
const COUNTRIES_RU=['Казахстан','Узбекистан','Кыргызстан','Таджикистан','Туркменистан','Россия','США','Германия','Другая'];
const COUNTRIES_EN=['Kazakhstan','Uzbekistan','Kyrgyzstan','Tajikistan','Turkmenistan','Russia','USA','Germany','Other'];
const ROLES=['CEO','CTO','CPO','CMO','CFO','COO','CSO'];
const LINKS_RU=['LinkedIn','Сайт','Instagram','Telegram','Twitter/X','Другое'];
const LINKS_EN=['LinkedIn','Website','Instagram','Telegram','Twitter/X','Other'];
const STAGES_RU=['Seed — MVP + первые клиенты','Pre-seed — идея / прототип'];
const STAGES_EN=['Seed — MVP + first clients','Pre-seed — idea / prototype'];
const ACTS_RU=['SaaS / B2B-платформа','Маркетплейс','Мобильное приложение','Fintech / Payments','Edtech','Logistics Tech / Supply Chain','HR Tech / Recruitment','Legal Tech','E-commerce / Retail Tech','PropTech','Agritech','Mediatech / Content','Analytics / BI','Dev Tools / API','Cybersecurity (без R&D)'];
const ACTS_EN=['SaaS / B2B Platform','Marketplace','Mobile App','Fintech / Payments','Edtech','Logistics Tech / Supply Chain','HR Tech / Recruitment','Legal Tech','E-commerce / Retail Tech','PropTech','Agritech','Mediatech / Content','Analytics / BI','Dev Tools / API','Cybersecurity (no R&D)'];

const SD={
  mkt:{id:'mkt',labelRu:'Market Sizing (TAM/SAM/SOM)',labelEn:'Market Sizing (TAM/SAM/SOM)',seed:'required',preseed:'required',
    whatRu:'Расчёт объёма рынка: TAM — весь рынок, SAM — достижимый, SOM — реальная доля.',whatEn:'Market size: TAM, SAM, SOM.',
    howRu:'Два метода: top-down и bottom-up. Указывайте источники (Statista, CB Insights).',howEn:'Top-down and bottom-up methods. Cite sources.',
    whyRu:'CMO+CCO верифицирует через независимые источники. Без источников — красный флаг.',whyEn:'Verified vs independent sources. No sources = red flag.'},
  tech:{id:'tech',labelRu:'Technology Overview',labelEn:'Technology Overview',seed:'required',preseed:'required',
    whatRu:'Стек и архитектура: frontend, backend, БД, инфраструктура.',whatEn:'Stack and architecture: frontend, backend, DB, infra.',
    howRu:'1–2 страницы + схема архитектуры. Обоснование ключевых решений.',howEn:'1–2 pages + architecture diagram.',
    whyRu:'CPO+CTO оценивает масштабируемость до 10× пользователей.',whyEn:'CPO+CTO evaluates scalability to 10× users.'},
  unit:{id:'unit',labelRu:'Unit Economics',labelEn:'Unit Economics',seed:'required',preseed:'optional',
    whatRu:'CAC, LTV, payback period, gross margin по сегментам.',whatEn:'CAC, LTV, payback period, gross margin.',
    howRu:'CAC = маркетинг / клиенты. LTV = ARPU × срок × margin. Три сценария.',howEn:'CAC = marketing / clients. LTV = ARPU × lifetime × margin.',
    whyRu:'CFO: LTV/CAC > 3× — норма. Сравнивает с бенчмарками a16z.',whyEn:'CFO: LTV/CAC > 3× is norm. vs a16z benchmarks.'},
  founders:{id:'founders',labelRu:'Профили основателей',labelEn:'Founder Profiles',seed:'required',preseed:'required',
    whatRu:'CV каждого фаундера: образование, опыт, LinkedIn.',whatEn:'CV per founder: education, experience, LinkedIn.',
    howRu:'Роль, достижения с цифрами. LinkedIn обязателен.',howEn:'Role, numbered achievements. LinkedIn required.',
    whyRu:'CHRO верифицирует через LinkedIn, Crunchbase. Без трекшна — главный актив.',whyEn:'CHRO verifies via LinkedIn, Crunchbase.'},
  cap:{id:'cap',labelRu:'Таблица капитализации (Cap Table)',labelEn:'Cap Table',seed:'required',preseed:'required',
    whatRu:'Доли: основатели, инвесторы, ESOP — с историей изменений.',whatEn:'Equity: founders, investors, ESOP — with history.',
    howRu:'Excel или PDF. Включите SAFE и конвертируемые займы.',howEn:'Excel or PDF. Include SAFEs and convertibles.',
    whyRu:'CFO и CLO оценивают dilution инвестора.',whyEn:'CFO and CLO evaluate investor dilution.'},
  val:{id:'val',labelRu:'Оценка компании (Pre-money)',labelEn:'Company Valuation (Pre-money)',seed:'required',preseed:'optional',
    whatRu:'Pre-money valuation с методологией: revenue multiple, scorecard, DCF.',whatEn:'Pre-money valuation: revenue multiple, scorecard, DCF.',
    howRu:'Метод + данные + расчёт + comparable сделки из Crunchbase.',howEn:'Method + data + calculation + Crunchbase comparables.',
    whyRu:'Без — CFO рассчитает самостоятельно тремя методами.',whyEn:'Without — CFO calculates independently.'},
  fin:{id:'fin',labelRu:'Финансовая модель',labelEn:'Financial Model',seed:'required',preseed:'required',
    whatRu:'Excel: P&L, cash flow, прогнозы 3–5 лет, burn rate, runway.',whatEn:'Excel: P&L, cash flow, 3–5 year forecasts, burn rate, runway.',
    howRu:'Три сценария: базовый, оптимистичный, консервативный. Формулы.',howEn:'Three scenarios: base, optimistic, conservative. Use formulas.',
    whyRu:'Ключевой документ CFO: арифметика и реалистичность допущений.',whyEn:'Key CFO doc: verifies arithmetic and assumptions.'},
};

const LEGAL=[
  {id:'ip',labelRu:'IP Assignment Agreements',labelEn:'IP Assignment Agreements',
    whatRu:'Передача прав на IP от основателей.',whatEn:'IP rights transfer from founders.',
    howRu:'Каждый разработчик подписывает до начала работы.',howEn:'Every developer signs before work begins.',
    whyRu:'Без — права на код у физлиц. Критический риск.',whyEn:'Without — code belongs to individuals. Critical risk.',
    exampleText:'YC IP Assignment Template',exampleUrl:'https://www.ycombinator.com/documents/'},
  {id:'tm',labelRu:'Товарные знаки, домен и Open Source',labelEn:'Trademarks, Domain & Open Source',
    whatRu:'ТЗ, домен, список OSS-библиотек с лицензиями.',whatEn:'TM, domain, OSS libraries with licenses.',
    howRu:'WHOIS, реестры патентов, список open-source.',howEn:'WHOIS, patent registries, OSS list.',
    whyRu:'GPL/AGPL в закрытом продукте = условие замены.',whyEn:'GPL/AGPL in closed product = must replace.',
    exampleText:'FOSSA for OSS audit',exampleUrl:null},
  {id:'corp',labelRu:'Учредительные документы',labelEn:'Incorporation Documents',
    whatRu:'Устав, свидетельство о регистрации, SHA.',whatEn:'Charter, registration, SHA.',
    howRu:'Если нет — оформление будет условием первого транша.',howEn:'If absent — incorporation is condition for first tranche.',
    whyRu:'Юридическая основа для сделки.',whyEn:'Legal foundation for the deal.',
    exampleText:'Официальные документы',exampleUrl:null},
  {id:'contracts',labelRu:'Договоры с сотрудниками',labelEn:'Employee Agreements',
    whatRu:'Трудовые договоры (шаблоны) с NDA.',whatEn:'Employment contracts (templates) with NDAs.',
    howRu:'Обезличенные копии без ФИО — стандарт Data Room.',howEn:'Anonymized copies — Data Room standard.',
    whyRu:'Подтверждает легальность команды.',whyEn:'Confirms team legality.',
    exampleText:'Шаблон обезличенного договора',exampleUrl:null},
  {id:'tos',labelRu:'Terms of Service & Privacy Policy',labelEn:'Terms of Service & Privacy Policy',
    whatRu:'Условия использования и политика конфиденциальности.',whatEn:'Terms of use and privacy policy.',
    howRu:'Опубликованы на сайте. Для всех юрисдикций.',howEn:'Published on site. For all jurisdictions.',
    whyRu:'GDPR нарушения = регуляторный риск.',whyEn:'GDPR violations = regulatory risk.',
    exampleText:'Termly.io или iubenda',exampleUrl:null},
];

const stageKey=s=>{if(!s)return'seed';if(s.includes('Seed')&&!s.includes('Pre'))return'seed';return'preseed';};
const docStatus=(doc,sk)=>doc[sk]==='required'?'required':doc[sk]==='optional'?'optional':'hidden';

function gateCheck(co,fnd,lang){
  const issues=[];
  if(!fnd||!fnd.length)return issues;
  if(!fnd.some(f=>CA.includes(f.country)))
    issues.push({type:'block',ru:'Нет фаундеров из ЦА. Минимум 1 из KZ/UZ/KG/TJ/TM.',en:'No Central Asia founders. Min 1 from KZ/UZ/KG/TJ/TM.'});
  const desc=(co.desc||'').toLowerCase();
  const bad=BLOCKED.find(k=>desc.includes(k));
  if(bad){
    const hard=['крипто','блокчейн','web3','nft','gambling','казино','crypto','blockchain','token','casino'].some(k=>desc.includes(k));
    issues.push({type:hard?'block':'warn',
      ru:hard?`Описание содержит "${bad}" — индустрия исключена.`:`Описание упоминает "${bad}" — уточните соответствие.`,
      en:hard?`Contains "${bad}" — excluded industry.`:`Mentions "${bad}" — verify match.`});
  }
  return issues;
}

const inp={width:'100%',boxSizing:'border-box',padding:'9px 12px',border:`1.5px solid ${T.border}`,borderRadius:10,background:'#fff',fontSize:13,color:T.text,fontFamily:'inherit',outline:'none',transition:'border-color .15s'};
const lbl={fontSize:11,color:T.textSubtle,fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5,display:'block'};

// ─── Accordion Section ────────────────────────────────────────────────────────

function AccordionSection({title,subtitle,open,onToggle,children,accentColor}){
  const ac=accentColor||T.accent;
  const acBg=accentColor?`${accentColor}12`:T.accentBg;
  const acBorder=accentColor?`${accentColor}55`:T.accentBorder;
  return(
    <div style={{background:'#fff',borderRadius:16,border:`1.5px solid ${open?acBorder:'#E2E6EC'}`,marginBottom:12,overflow:'hidden',transition:'border-color .25s,box-shadow .25s',boxShadow:open?`0 4px 20px ${ac}18`:'0 1px 4px rgba(0,0,0,.05)'}}>
      <button onClick={onToggle} style={{width:'100%',background:open?acBg:'#fff',border:'none',borderBottom:open?`1px solid ${acBorder}`:'none',padding:'17px 22px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',fontFamily:'inherit',transition:'background .2s',textAlign:'left'}}
        onMouseOver={e=>{if(!open)e.currentTarget.style.background='#F7F9FC';}}
        onMouseOut={e=>{if(!open)e.currentTarget.style.background='#fff';}}>
        <div style={{flex:1}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text}}>{title}</div>
          {subtitle&&<div style={{fontSize:12,color:T.textSubtle,marginTop:3}}>{subtitle}</div>}
        </div>
        <div style={{transform:open?'rotate(180deg)':'rotate(0deg)',transition:'transform .25s',color:open?ac:T.textSubtle,flexShrink:0}}>
          <IChevD sz={20} col={open?ac:T.textSubtle}/>
        </div>
      </button>
      {open&&<div style={{padding:'18px 22px'}}>{children}</div>}
    </div>
  );
}

// ─── Sub Accordion (inside Data Room) ─────────────────────────────────────────

function SubAccordion({title,subtitle,open,onToggle,children,color,noToggle}){
  return(
    <div style={{border:`1.5px solid ${color}44`,borderRadius:14,overflow:'hidden',marginBottom:14}}>
      <div onClick={noToggle?undefined:onToggle} style={{padding:'12px 18px',background:`${color}0d`,borderBottom:open?`1px solid ${color}33`:'none',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:noToggle?'default':'pointer'}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color,letterSpacing:'.1em',marginBottom:subtitle?2:0}}>{title}</div>
          {subtitle&&<div style={{fontSize:11,color:T.textSubtle}}>{subtitle}</div>}
        </div>
        {!noToggle&&<div style={{transform:open?'rotate(180deg)':'rotate(0deg)',transition:'transform .22s',color,flexShrink:0}}>
          <IChevD sz={16} col={color}/>
        </div>}
      </div>
      {open&&<div style={{padding:'14px 16px'}}>{children}</div>}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({toasts,onDismiss}){
  return(
    <div style={{position:'fixed',top:80,right:24,zIndex:9999,display:'flex',flexDirection:'column',gap:10,pointerEvents:'none'}}>
      {toasts.map(toast=>(
        <div key={toast.id} onClick={()=>onDismiss(toast.id)} style={{
          background:'#fff',
          border:`1.5px solid ${toast.type==='success'?T.greenBorder:T.accentBorder}`,
          borderLeft:`4px solid ${toast.type==='success'?T.green:T.accent}`,
          borderRadius:12,padding:'13px 16px',
          display:'flex',alignItems:'center',gap:10,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)',
          pointerEvents:'auto',cursor:'pointer',
          minWidth:280,maxWidth:360,
          animation:'slideInToast .35s cubic-bezier(.22,.68,0,1.2)',
        }}>
          <div style={{width:28,height:28,borderRadius:8,background:toast.type==='success'?T.greenBg:T.accentBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            {toast.type==='success'
              ?<ICheck sz={14} col={T.green}/>
              :<div style={{fontSize:12,fontWeight:800,color:T.accent}}>!</div>}
          </div>
          <span style={{fontSize:13,color:T.text,flex:1,lineHeight:1.4}}>{toast.msg}</span>
          <IX sz={12} col={T.textSubtle}/>
        </div>
      ))}
      <style>{`@keyframes slideInToast{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

// ─── DocInfo ──────────────────────────────────────────────────────────────────

function DocInfo({doc,lang,t,onAsk}){
  const [open,setOpen]=useState(false);
  if(!doc)return null;
  const lbl2=lang==='ru'?doc.labelRu:doc.labelEn;
  const q=lang==='ru'?`Объясни документ "${lbl2}": что это, как подготовить и зачем инвестору?`:`Explain "${lbl2}": what is it, how to prepare, why needed?`;
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
        <button onClick={()=>setOpen(v=>!v)} style={{display:'flex',alignItems:'center',gap:4,background:'none',border:'none',cursor:'pointer',fontSize:11,color:T.textSubtle,fontFamily:'inherit',padding:'3px 0',transition:'color .15s'}}
          onMouseOver={e=>e.currentTarget.style.color=T.textMuted} onMouseOut={e=>e.currentTarget.style.color=T.textSubtle}>
          {t.details} <div style={{transform:open?'rotate(180deg)':'none',transition:'transform .2s',display:'inline-flex'}}><IChevD sz={10} col={T.textSubtle}/></div>
        </button>
        {onAsk&&<button onClick={()=>onAsk(q)} title={lang==='ru'?'Спросить ИИ':'Ask AI'}
          style={{width:20,height:20,borderRadius:'50%',border:`1.5px solid ${T.accentBorder}`,background:T.accentBg,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:T.accent,padding:0,flexShrink:0,transition:'all .15s'}}
          onMouseOver={e=>{e.currentTarget.style.background=T.accent;e.currentTarget.style.color='#fff';e.currentTarget.style.transform='scale(1.12)';}}
          onMouseOut={e=>{e.currentTarget.style.background=T.accentBg;e.currentTarget.style.color=T.accent;e.currentTarget.style.transform='scale(1)';}}>i</button>}
      </div>
      {open&&<div style={{marginTop:8,borderRadius:12,overflow:'hidden',border:`1px solid ${T.accentBorder}`}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr'}}>
          {[
            {h:t.whatIs,b:lang==='ru'?doc.whatRu:doc.whatEn,bg:'#EFF6FF',c:'#1D4ED8'},
            {h:t.how,b:lang==='ru'?doc.howRu:doc.howEn,bg:T.greenBg,c:'#15803D'},
            {h:t.why,b:lang==='ru'?doc.whyRu:doc.whyEn,bg:T.purpleBg,c:T.purple},
            {h:lang==='ru'?'ПРИМЕР':'EXAMPLE',b:doc.exampleText||'Свободная форма',url:doc.exampleUrl,bg:'#FAF5FF',c:'#7C3AED'},
          ].map((col,i)=>(
            <div key={i} style={{padding:'10px 12px',background:col.bg,borderRight:i<3?`1px solid ${T.borderLight}`:'none'}}>
              <div style={{fontSize:10,fontWeight:700,color:col.c,letterSpacing:'.1em',marginBottom:5}}>{col.h}</div>
              <div style={{fontSize:11,color:T.textMuted,lineHeight:1.6}}>
                {col.url?<a href={col.url} target="_blank" rel="noreferrer" style={{color:'#7C3AED',fontWeight:600,textDecoration:'underline'}}>{col.b}</a>:col.b}
              </div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}

// ─── SlotRow ──────────────────────────────────────────────────────────────────

function SlotRow({id,doc,val,status,onUp,lang,t,onAsk,firstRound,onFR}){
  const label=lang==='ru'?doc.labelRu:doc.labelEn;
  const filled=Boolean(val)||firstRound;
  const opt=status==='optional';
  if(status==='hidden')return null;
  return(
    <div style={{borderTop:`1px solid ${T.borderLight}`,padding:'10px 0'}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
        <div style={{flexShrink:0,width:18,paddingTop:2}}>
          {filled?<ICheck sz={14}/>:opt?<span style={{fontSize:11,color:T.amber,fontWeight:700}}>?</span>:<IXc sz={14}/>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
            <span style={{fontSize:13,fontWeight:600,color:T.text}}>{label}</span>
            {opt&&<span style={{fontSize:10,color:T.amber,background:T.amberBg,border:`1px solid ${T.amberBorder}`,padding:'1px 7px',borderRadius:5,fontWeight:600}}>{t.optional}</span>}
          </div>
          {val&&!firstRound&&<div style={{fontSize:11,color:T.textSubtle,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{val}</div>}
          {firstRound&&<div style={{fontSize:11,color:T.textMuted,marginBottom:2}}>{lang==='ru'?'Первый раунд':'First round'}</div>}
          <DocInfo doc={doc} lang={lang} t={t} onAsk={onAsk}/>
        </div>
        <div style={{flexShrink:0,display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
          {id==='rounds'&&!val&&onFR&&(
            <button onClick={onFR} style={{fontSize:11,color:firstRound?T.green:T.textMuted,padding:'5px 10px',border:`1px solid ${firstRound?T.greenBorder:T.border}`,borderRadius:8,cursor:'pointer',background:firstRound?T.greenBg:'white',fontFamily:'inherit',fontWeight:firstRound?700:500,whiteSpace:'nowrap'}}>
              {firstRound?t.firstRoundDone:t.firstRound}
            </button>
          )}
          <label style={{fontSize:11,padding:'6px 12px',border:`1.5px solid ${filled?T.border:opt?T.amberBorder:T.redBorder}`,borderRadius:9,cursor:'pointer',background:filled?'#fff':opt?T.amberBg:T.redBg,fontWeight:700,whiteSpace:'nowrap',fontFamily:'inherit',color:filled?T.textMuted:opt?T.amber:T.red,display:'block',transition:'all .15s'}}
            onMouseOver={e=>{e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.1)';e.currentTarget.style.transform='translateY(-1px)';}}
            onMouseOut={e=>{e.currentTarget.style.boxShadow='none';e.currentTarget.style.transform='none';}}>
            {filled&&!firstRound?t.replace:t.upload}
            <input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)onUp(id,f.name);}}/>
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({id,doc,val,onUp,lang,t,onAsk}){
  const [drag,setDrag]=useState(false);
  const label=lang==='ru'?doc.labelRu:doc.labelEn;
  const onDrop=useCallback(e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files?.[0];if(f)onUp(id,f.name);},[id,onUp]);
  return(
    <div>
      <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={onDrop}
        style={{border:`2px dashed ${drag?T.accent:val?T.green:T.border}`,borderRadius:12,padding:14,textAlign:'center',background:drag?T.accentBg:val?T.greenBg:'#fafaf7',transition:'all .18s'}}>
        {val?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,flexWrap:'wrap'}}>
            <ICheck sz={14}/><span style={{fontSize:13,color:T.green,fontWeight:700,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{val}</span>
            <label style={{fontSize:12,color:T.textMuted,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',background:'white',fontFamily:'inherit',fontWeight:600,transition:'all .15s'}}
              onMouseOver={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.1)'} onMouseOut={e=>e.currentTarget.style.boxShadow='none'}>
              {t.replace}<input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)onUp(id,f.name)}}/>
            </label>
          </div>
        ):(
          <label style={{cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:7}}>
            <IUpload sz={20} col={drag?T.accent:'#bbb'}/>
            <span style={{fontSize:12,color:T.textMuted}}><span style={{color:T.accent,fontWeight:700}}>{label}</span> — {lang==='ru'?'перетащите или нажмите':'drag or click'}</span>
            <input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)onUp(id,f.name)}}/>
          </label>
        )}
      </div>
      <DocInfo doc={doc} lang={lang} t={t} onAsk={onAsk}/>
    </div>
  );
}

// ─── FounderBlock ─────────────────────────────────────────────────────────────

function FounderBlock({founder,index,lang,onChange,onRemove}){
  const t=L[lang];
  const countries=lang==='ru'?COUNTRIES_RU:COUNTRIES_EN;
  const linkTypes=lang==='ru'?LINKS_RU:LINKS_EN;
  const links=founder.links||[];
  return(
    <div style={{background:'#F8F9FF',borderRadius:16,padding:18,border:`1.5px solid ${T.accentBorder}`,marginBottom:12,boxShadow:`0 0 0 3px ${T.accentBg}`}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:T.accentBg,border:`2px solid ${T.accentBorder}`,display:'flex',alignItems:'center',justifyContent:'center'}}><IUser sz={15} col={T.accent}/></div>
          <span style={{fontSize:14,fontWeight:700,color:T.text}}>{t.founder} {index+1}</span>
        </div>
        {index>0&&<button onClick={onRemove} style={{display:'flex',alignItems:'center',gap:5,background:'#FEF2F2',border:`1px solid ${T.redBorder}`,borderRadius:8,cursor:'pointer',padding:'5px 10px',color:T.red,fontSize:12,fontFamily:'inherit',fontWeight:600,transition:'all .15s'}}
          onMouseOver={e=>e.currentTarget.style.boxShadow='0 2px 6px rgba(220,38,38,.2)'} onMouseOut={e=>e.currentTarget.style.boxShadow='none'}>
          <IX sz={11} col={T.red}/>{lang==='ru'?'Удалить':'Remove'}
        </button>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div><label style={lbl}>{t.name}</label><input style={inp} value={founder.name||''} onChange={e=>onChange({name:e.target.value})} placeholder="Иванов Иван"/></div>
        <div><label style={lbl}>{t.country}</label>
          <select style={inp} value={founder.country||'Казахстан'} onChange={e=>onChange({country:e.target.value})}>
            {countries.map((c,i)=><option key={c} value={COUNTRIES_RU[i]}>{c}</option>)}
          </select>
        </div>
      </div>
      <div style={{marginBottom:12}}><label style={lbl}>{t.role}</label>
        <select style={inp} value={founder.role||'CEO'} onChange={e=>onChange({role:e.target.value})}>
          {ROLES.map(r=><option key={r}>{r}</option>)}
        </select>
      </div>
      {links.length>0&&<div style={{marginBottom:10}}>
        <label style={{...lbl,display:'flex',alignItems:'center',gap:4}}><IGlobe sz={10}/>{t.linkUrl}</label>
        {links.map((link,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:`130px 1fr${i>0?' 36px':''}`,gap:8,marginBottom:8,alignItems:'center'}}>
            <select style={inp} value={link.type||linkTypes[0]} onChange={e=>onChange({links:links.map((l,j)=>j===i?{...l,type:e.target.value}:l)})}>
              {linkTypes.map(lt=><option key={lt}>{lt}</option>)}
            </select>
            <input style={inp} value={link.url||''} onChange={e=>onChange({links:links.map((l,j)=>j===i?{...l,url:e.target.value}:l)})} placeholder="linkedin.com/in/username"/>
            {i>0&&<button onClick={()=>onChange({links:links.filter((_,j)=>j!==i)})}
              style={{height:38,background:'#FEF2F2',border:`1px solid ${T.redBorder}`,borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <IX sz={11} col={T.red}/></button>}
          </div>
        ))}
      </div>}
      <button onClick={()=>onChange({links:[...links,{type:linkTypes[0],url:''}]})}
        style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:T.accent,background:T.accentBg,border:`1px dashed ${T.accentBorder}`,cursor:'pointer',padding:'7px 14px',borderRadius:9,fontFamily:'inherit',fontWeight:600,transition:'all .15s'}}
        onMouseOver={e=>e.currentTarget.style.background='rgba(29,107,252,.12)'} onMouseOut={e=>e.currentTarget.style.background=T.accentBg}>
        <IPlus sz={12} col={T.accent}/>{t.addLink}
      </button>
      {links.some(l=>l.url)&&<div style={{marginTop:10,fontSize:12,color:T.green,display:'flex',alignItems:'center',gap:5,padding:'6px 10px',background:T.greenBg,borderRadius:8,border:`1px solid ${T.greenBorder}`}}>
        <ICheck sz={11} col={T.green}/>{lang==='ru'?'Агент CHRO верифицирует профиль':'CHRO agent will verify profile'}
      </div>}
    </div>
  );
}

// ─── CompanyBlock (без валюты) ────────────────────────────────────────────────

function CompanyBlock({data,lang,onChange,founders}){
  const t=L[lang];
  const acts=lang==='ru'?ACTS_RU:ACTS_EN;
  const stages=lang==='ru'?STAGES_RU:STAGES_EN;
  const issues=gateCheck(data,founders||[],lang);
  const hasBlock=issues.some(i=>i.type==='block');
  const ok=data.company&&data.company.trim().length>1&&data.activity&&!hasBlock&&issues.length===0;
  return(
    <div style={{background:T.surface,borderRadius:14,padding:18,border:`1px solid ${T.border}`}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div><label style={lbl}>{t.company} *</label><input style={inp} value={data.company||''} onChange={e=>onChange({company:e.target.value})} placeholder="FastRoute"/></div>
        <div><label style={lbl}>{t.activity} *</label>
          <select style={inp} value={data.activity||''} onChange={e=>onChange({activity:e.target.value})}>
            <option value="">{t.chooseActivity}</option>
            {acts.map((a,i)=><option key={a} value={ACTS_RU[i]}>{a}</option>)}
          </select>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
        <div><label style={lbl}>{t.stage} *</label>
          <select style={inp} value={data.stage||STAGES_RU[0]} onChange={e=>onChange({stage:e.target.value})}>
            {stages.map((s,i)=><option key={s} value={STAGES_RU[i]}>{s}</option>)}
          </select>
        </div>
        <div><label style={lbl}>{t.email} *</label><input style={inp} type="email" value={data.email||''} onChange={e=>onChange({email:e.target.value})} placeholder="alex@startup.kz"/></div>
      </div>
      <div style={{marginBottom:12}}><label style={lbl}>{t.desc}</label>
        <textarea style={{...inp,height:72,resize:'vertical',lineHeight:1.5}} value={data.desc||''} onChange={e=>onChange({desc:e.target.value})} placeholder={lang==='ru'?'Кратко опишите проект...':'Briefly describe the project...'}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14,alignItems:'end'}}>
        <div><label style={lbl}>{t.site}</label><input style={inp} value={data.site||''} onChange={e=>onChange({site:e.target.value})} placeholder="fastroute.kz"/></div>
        <div><label style={lbl}>{t.invest} (USD) *</label><input style={inp} value={data.invest||''} onChange={e=>onChange({invest:e.target.value})} placeholder="500 000"/></div>
      </div>
      {ok&&<div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:T.green,background:T.greenBg,border:`1px solid ${T.greenBorder}`,borderRadius:9,padding:'9px 13px'}}><ICheck sz={13}/><strong>{t.siteCheck}</strong></div>}
      {issues.map((iss,i)=>(
        <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,fontSize:12,color:iss.type==='block'?T.red:T.amber,background:iss.type==='block'?T.redBg:T.amberBg,border:`1px solid ${iss.type==='block'?T.redBorder:T.amberBorder}`,borderRadius:9,padding:'10px 14px',marginTop:8}}>
          <span style={{fontSize:15,flexShrink:0}}>{iss.type==='block'?'🚫':'⚠️'}</span>
          <div style={{lineHeight:1.55}}>{lang==='ru'?iss.ru:iss.en}</div>
        </div>
      ))}
    </div>
  );
}

// ─── AI Chat Sidebar ──────────────────────────────────────────────────────────

function AIChatSidebar({lang,extMsg,extKey,ctx}){
  const t=L[lang];
  const welcome=lang==='ru'
    ?'Привет! Я здесь, чтобы помочь заполнить заявку.\n\nНажимайте кнопку ⓘ рядом с любым документом — я сразу объясню:\n• Что это такое\n• Как подготовить\n• Зачем это нужно инвестору\n\nЧем могу помочь?'
    :'Hi! I\'m here to help you complete the application.\n\nClick the ⓘ button next to any document — I\'ll explain:\n• What it is\n• How to prepare it\n• Why the investor needs it\n\nHow can I help?';
  const [msgs,setMsgs]=useState([{role:'assistant',content:welcome}]);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(false);
  const [hist,setHist]=useState([]);
  const endRef=useRef(null);
  const inpRef=useRef(null);

  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'});},[msgs,loading]);
  useEffect(()=>{if(extMsg){send(extMsg);setTimeout(()=>inpRef.current?.focus(),300);}},[extKey]);

  async function send(text){
    const q=(text||input).trim();if(!q||loading)return;
    setInput('');
    const um={role:'user',content:q};
    const nh=[...hist,um];
    setMsgs(p=>[...p,{role:'user',content:q}]);setLoading(true);
    try{
      const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:q,context:{...(ctx||{}),lang},history:nh.slice(-8)})});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      const reply=d.reply||(lang==='ru'?'Ошибка. Попробуйте ещё раз.':'Error. Please try again.');
      setMsgs(p=>[...p,{role:'assistant',content:reply}]);
      setHist([...nh,{role:'assistant',content:reply}]);
    }catch{
      setMsgs(p=>[...p,{role:'assistant',content:lang==='ru'?'Не удалось подключиться.':'Could not connect.'}]);
    }
    setLoading(false);
  }

  const qs=[t.suggestQ1,t.suggestQ2,lang==='ru'?'Что такое Gate Check?':'What is Gate Check?',lang==='ru'?'Расскажи о юридическом пакете':'Tell me about the legal package'];

  return(
    <div style={{position:'sticky',top:72,background:'#fff',borderRadius:18,border:`1.5px solid ${T.accentBorder}`,display:'flex',flexDirection:'column',height:'calc(100vh - 90px)',maxHeight:720,overflow:'hidden',boxShadow:'0 6px 30px rgba(29,107,252,.1)',fontFamily:'inherit'}}>
      {/* Header */}
      <div style={{padding:'16px 20px',borderBottom:`1px solid ${T.borderLight}`,background:'linear-gradient(135deg,#EEF4FF 0%,#F4F8FF 100%)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:42,height:42,borderRadius:13,background:'linear-gradient(135deg,#3b82f6 0%,#6366f1 100%)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow:'0 4px 14px rgba(59,130,246,.35)'}}>
            <IStar sz={18} col="#fff"/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.text,letterSpacing:'-0.2px'}}>{t.aiAssistant}</div>
            <div style={{fontSize:11,color:T.textSubtle,marginTop:1}}>{t.aiSub}</div>
          </div>
          <div style={{width:8,height:8,borderRadius:'50%',background:'#22c55e',boxShadow:'0 0 0 2px #dcfce7'}}/>
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'14px 16px',display:'flex',flexDirection:'column',gap:12,background:'#FAFBFF'}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',alignItems:'flex-end',gap:8}}>
            {m.role==='assistant'&&<div style={{width:28,height:28,borderRadius:9,background:T.accentBg,border:`1px solid ${T.accentBorder}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginBottom:2}}>
              <IStar sz={12} col={T.accent}/>
            </div>}
            <div style={{maxWidth:'80%',padding:'10px 14px',borderRadius:m.role==='user'?'16px 16px 4px 16px':'4px 16px 16px 16px',background:m.role==='user'?T.accent:'#fff',color:m.role==='user'?'#fff':T.text,fontSize:13,lineHeight:1.65,whiteSpace:'pre-wrap',border:m.role==='user'?'none':`1px solid ${T.borderLight}`,boxShadow:m.role==='user'?'none':'0 1px 4px rgba(0,0,0,.05)'}}>
              {m.content}
            </div>
          </div>
        ))}
        {loading&&<div style={{display:'flex',alignItems:'flex-end',gap:8}}>
          <div style={{width:28,height:28,borderRadius:9,background:T.accentBg,border:`1px solid ${T.accentBorder}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <IStar sz={12} col={T.accent}/>
          </div>
          <div style={{padding:'10px 16px',background:'#fff',borderRadius:'4px 16px 16px 16px',border:`1px solid ${T.borderLight}`,display:'flex',gap:5,alignItems:'center'}}>
            {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:T.accent,opacity:.4,animation:`aDot2 1.2s ${i*.2}s infinite`}}/>)}
          </div>
        </div>}
        <div ref={endRef}/>
      </div>

      {/* Suggested questions */}
      {msgs.length<=2&&<div style={{padding:'0 14px 8px',display:'flex',flexDirection:'column',gap:6}}>
        {qs.map((q,i)=>(
          <button key={i} onClick={()=>send(q)} style={{padding:'10px 14px',borderRadius:11,border:`1px solid ${T.border}`,background:'#F7F9FC',color:T.text,fontSize:13,textAlign:'left',cursor:'pointer',fontFamily:'inherit',transition:'all .15s',lineHeight:1.4}}
            onMouseOver={e=>{e.currentTarget.style.background=T.accentBg;e.currentTarget.style.borderColor=T.accentBorder;e.currentTarget.style.color=T.accent;}}
            onMouseOut={e=>{e.currentTarget.style.background='#F7F9FC';e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.text;}}>
            {q}
          </button>
        ))}
      </div>}

      {/* Input */}
      <div style={{padding:'10px 14px 16px',borderTop:`1px solid ${T.borderLight}`,background:'#fff',flexShrink:0}}>
        <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
          <textarea ref={inpRef} value={input}
            onChange={e=>{setInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px';}}
            onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),send())}
            placeholder={t.aiPlaceholder} rows={1}
            style={{flex:1,border:`1.5px solid ${T.border}`,borderRadius:10,padding:'9px 12px',fontSize:13,fontFamily:'inherit',outline:'none',resize:'none',maxHeight:100,overflowY:'auto',color:T.text,lineHeight:1.4,transition:'border-color .15s'}}
            onFocus={e=>e.target.style.borderColor=T.accent}
            onBlur={e=>e.target.style.borderColor=T.border}/>
          <button onClick={()=>send()} disabled={loading||!input.trim()}
            style={{width:38,height:38,borderRadius:10,background:input.trim()?T.accent:'#E8EDF5',border:'none',cursor:input.trim()?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .18s',boxShadow:input.trim()?'0 3px 12px rgba(29,107,252,.4)':'none'}}>
            <ISend sz={15} col="#fff"/>
          </button>
        </div>
        <div style={{textAlign:'center',marginTop:6,fontSize:10,color:T.textSubtle}}>{lang==='ru'?'Enter — отправить · Shift+Enter — новая строка':'Enter to send · Shift+Enter for new line'}</div>
      </div>
      <style>{`@keyframes aDot2{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}`}</style>
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

function Home({go}){
  return(
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'2rem',padding:'3.5rem 1.5rem',background:'#fff'}}>
      <div style={{textAlign:'center'}}>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,padding:'4px 14px',background:'#F0EEE9',borderRadius:100,marginBottom:14,border:`1px solid ${T.border}`}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:T.accent}}/><span style={{fontSize:11,letterSpacing:'.12em',color:T.textMuted,textTransform:'uppercase',fontWeight:600}}>Activat VC</span>
        </div>
        <h1 style={{fontSize:48,fontWeight:800,color:T.text,margin:'0 0 .75rem',letterSpacing:'-1.8px',lineHeight:1.1}}>VentureIQ</h1>
        <p style={{fontSize:14,color:T.textMuted,maxWidth:420,lineHeight:1.75,margin:'0 auto'}}>Автоматизированный due diligence стартапов. 6 ИИ-агентов, Investment Score 1–10.</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',width:'100%',maxWidth:560}}>
        {[
          {l:'Фаундерам',s:'Подать заявку — ИИ-ассистент поможет',sc:SC.FORM,col:T.accent,bg:T.accentBg,bd:T.accentBorder},
          {l:'Инвесторам',s:'Демо-отчёт с чатом Orchestrator',sc:SC.INVESTOR,col:T.green,bg:T.greenBg,bd:T.greenBorder},
          {l:'Бухгалтерия',s:'Сделки к оплате · реестр платежей',sc:null,col:'#7c3aed',bg:'#F5F3FF',bd:'#C4B5FD'},
          {l:'Шаблоны',s:'Договоры — 9 слотов (SAFE/Equity/Note)',sc:null,col:T.textMuted,bg:'#F3F1EC',bd:T.border},
          {l:'Портфель',s:'Мониторинг KPI портфельных компаний',sc:null,col:'#0891b2',bg:'#ECFEFF',bd:'#A5F3FC'},
        ].map((x,i)=>(
          <button key={i} onClick={()=>x.sc&&go(x.sc)}
            style={{background:T.surface,borderRadius:14,padding:'1.25rem',boxShadow:'0 1px 4px rgba(26,23,20,.06)',cursor:x.sc?'pointer':'default',textAlign:'left',border:`1px solid ${T.border}`,transition:'box-shadow .2s,transform .18s',opacity:x.sc?1:.62}}
            onMouseEnter={e=>{if(x.sc){e.currentTarget.style.boxShadow='0 8px 28px rgba(0,0,0,.12)';e.currentTarget.style.transform='translateY(-2px)';}}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 1px 4px rgba(26,23,20,.06)';e.currentTarget.style.transform='none';}}>
            <div style={{width:38,height:38,borderRadius:10,background:x.bg,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:12,border:`1px solid ${x.bd}`}}><IArrow sz={17} col={x.col}/></div>
            <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:4}}>{x.l}</div>
            <p style={{fontSize:13,color:T.textMuted,lineHeight:1.5,margin:'0 0 12px'}}>{x.s}</p>
            <div style={{display:'flex',alignItems:'center',gap:4,fontSize:13,color:x.col,fontWeight:600}}>{x.sc?'Открыть':'Скоро'}{x.sc&&<IArrow sz={13} col={x.col}/>}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function Form({go}){
  const [lang,setLang]=useState('ru');
  const t=L[lang];
  const [founders,setFounders]=useState([{name:'',country:'Казахстан',role:'CEO',links:[{type:'LinkedIn',url:''}]}]);
  const [co,setCo]=useState({company:'',activity:'',stage:STAGES_RU[0],email:'',desc:'',site:'',invest:''});
  const [docs,setDocs]=useState({});
  const [aiMsg,setAiMsg]=useState(null);
  const [aiKey,setAiKey]=useState(0);
  const [fr,setFr]=useState(false);
  const [pubUrl,setPubUrl]=useState('');

  // Accordion states: company open by default
  const [sections,setSections]=useState({company:true,founder:false,dataroom:false});
  // Data room sub-sections: mandatory auto-opens when dataroom opens
  const [drSubs,setDrSubs]=useState({mandatory:false,demo:false,legal:false});

  const toggleSection=(key)=>{
    const opening=!sections[key];
    setSections(s=>({...s,[key]:!s[key]}));
    if(key==='dataroom'&&opening){
      setDrSubs(s=>({...s,mandatory:true}));
    }
  };

  // Toast system
  const [toasts,setToasts]=useState([]);

  // ─── Submission state ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState(null); // null | 'sending' | 'analyzing' | 'done' | 'error'
  const [runResult, setRunResult] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  async function handleSubmit() {
    if (!canSub || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitPhase('sending');

    try {
      const payload = buildStartupPayload(co, founders, docs);
      const run = await triggerAnalysis(payload);

      setSubmitPhase('analyzing');

      const completed = await pollRunStatus(
        run.id,
        (update) => {
          // Обновляем тост с прогрессом
          const done = (update.completed_tasks_count || 0);
          const total = (update.total_tasks_count || 0);
          if (total > 0) {
            setToasts([{
              id: 'progress',
              text: lang === 'ru'
                ? `Анализ: ${done}/${total} агентов завершено`
                : `Analysis: ${done}/${total} agents complete`,
              color: T.accent,
            }]);
          }
        },
        { intervalMs: 4000, maxWaitMs: 600_000 }
      );

      setRunResult(completed);
      setSubmitPhase('done');
      setToasts([{
        id: 'success',
        text: lang === 'ru' ? '✓ Анализ завершён! Результаты готовы.' : '✓ Analysis complete! Results ready.',
        color: T.green,
      }]);

      // Переходим на дашборд инвестора с данными анализа
      setTimeout(() => {
        go(SC.INVESTOR, { co, founders, runResult: completed });
      }, 1200);
    } catch (err) {
      console.error('Submit error:', err);
      setSubmitError(err.message);
      setSubmitPhase('error');
      setToasts([{
        id: 'error',
        text: lang === 'ru'
          ? `Ошибка отправки: ${err.message}`
          : `Submission error: ${err.message}`,
        color: T.red,
      }]);
    } finally {
      setSubmitting(false);
    }
  }
  const addToast=useCallback((msg,type='info')=>{
    const id=Date.now()+Math.random();
    setToasts(t=>[...t,{id,msg,type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),5000);
  },[]);

  const hasSaved=useRef(false);
  useEffect(()=>{
    if(hasSaved.current)return;
    const timer=setTimeout(()=>{addToast(t.draftSaved,'success');hasSaved.current=true;},2500);
    return()=>clearTimeout(timer);
  },[]);

  const hintShown=useRef(false);
  useEffect(()=>{
    if(hintShown.current||!co.company||!co.activity||!founders[0]?.name||docs.pitch)return;
    const timer=setTimeout(()=>{addToast(t.draftHint,'info');hintShown.current=true;},6000);
    return()=>clearTimeout(timer);
  },[co.company,co.activity,founders[0]?.name,docs.pitch]);

  const upDoc=(id,name)=>setDocs(d=>({...d,[id]:name}));
  const upFnd=(i,p)=>setFounders(f=>f.map((fd,j)=>j===i?{...fd,...p}:fd));
  const sk=stageKey(co.stage);
  const gs=(doc)=>docStatus(doc,sk);

  const reqIds=['pitch',...['mkt','tech','unit','founders','cap','val'].filter(id=>SD[id]&&SD[id][sk]==='required'),'fin'];
  const issues=gateCheck(co,founders,lang);
  const blocked=issues.some(i=>i.type==='block');
  const canSub=reqIds.every(id=>Boolean(docs[id]))&&!blocked;

  const openAI=(msg)=>{setAiMsg(msg||null);setAiKey(k=>k+1);};
  const ctx={company:co.company,activity:co.activity,stage:co.stage,email:co.email,desc:co.desc,founders:founders.map(f=>({name:f.name,country:f.country,role:f.role}))};

  const videoDoc={id:'video',labelRu:'Видео-демонстрация',labelEn:'Video Demo',whatRu:'Запись экрана 5–15 мин с комментарием.',whatEn:'Screen recording 5–15 min with commentary.',howRu:'Через Loom: регистрация, core flow, aha-момент.',howEn:'Via Loom: registration, core flow, aha moment.',whyRu:'CPO+CTO проходит продукт изнутри.',whyEn:'CPO+CTO evaluates from inside.'};
  const roundsDoc={id:'rounds',labelRu:'Документы предыдущих раундов',labelEn:'Previous Round Documents',whatRu:'Term sheet, SAFE, займы.',whatEn:'Term sheet, SAFE, loans.',howRu:'Если первый раунд — нажмите кнопку.',howEn:'First round — click the button.',whyRu:'CFO и CLO оценивают существующие обязательства.',whyEn:'CFO and CLO evaluate existing obligations.'};
  const pitchDoc={id:'pitch',labelRu:'Pitch Deck',labelEn:'Pitch Deck',whatRu:'Презентация 10–20 слайдов: проблема, решение, рынок, бизнес-модель, трекшн, команда.',whatEn:'10–20 slides: problem, solution, market, business model, traction, team.',howRu:'PDF или PowerPoint. Четко, без воды.',howEn:'PDF or PowerPoint. Clear and concise.',whyRu:'Все 6 агентов начинают с него. Без — заявка не обрабатывается.',whyEn:'All 6 agents start with it. Without — application not processed.'};

  return(
    <div style={{fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif',background:T.bg,minHeight:'100vh',WebkitFontSmoothing:'antialiased'}}>

      {/* Header */}
      <div style={{position:'sticky',top:0,zIndex:200,background:'rgba(255,255,255,.96)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)',borderBottom:`1px solid ${T.border}`,padding:'11px 24px',display:'flex',alignItems:'center',gap:16}}>
        <button onClick={()=>go(SC.HOME)}
          style={{display:'flex',alignItems:'center',gap:7,padding:'7px 16px',background:T.accent,border:'none',borderRadius:9,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',transition:'all .18s',boxShadow:'0 2px 8px rgba(29,107,252,.3)',flexShrink:0}}
          onMouseOver={e=>{e.currentTarget.style.background=T.accentHover;}}
          onMouseOut={e=>{e.currentTarget.style.background=T.accent;}}>
          {t.back}
        </button>
        <h1 style={{flex:1,textAlign:'center',fontSize:17,fontWeight:700,color:T.text,margin:0,letterSpacing:'-0.3px'}}>{t.title}</h1>
        <div style={{display:'flex',gap:3,background:'#EBF3FE',borderRadius:10,padding:3,flexShrink:0}}>
          {['ru','en'].map(l=>(
            <button key={l} onClick={()=>setLang(l)} style={{fontSize:13,padding:'5px 14px',borderRadius:8,border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:lang===l?700:500,background:lang===l?T.accent:'transparent',color:lang===l?'#fff':T.textMuted,boxShadow:lang===l?'0 2px 6px rgba(29,107,252,.3)':'none',transition:'all .18s'}}>
              {l==='ru'?'Ru':'Eng'}
            </button>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div style={{display:'flex',gap:18,padding:'20px 24px 60px',maxWidth:1340,margin:'0 auto',alignItems:'flex-start'}}>

        {/* Left: Form */}
        <div style={{flex:1,minWidth:0}}>

          {/* Section 1: Company */}
          <AccordionSection
            title={t.companySection}
            subtitle={t.companySub}
            open={sections.company}
            onToggle={()=>toggleSection('company')}>
            <CompanyBlock data={co} lang={lang} onChange={p=>setCo(d=>({...d,...p}))} founders={founders}/>
          </AccordionSection>

          {/* Section 2: Founder */}
          <AccordionSection
            title={t.founderSection}
            subtitle={t.founderSub}
            open={sections.founder}
            onToggle={()=>toggleSection('founder')}>
            {founders.map((f,i)=><FounderBlock key={i} founder={f} index={i} lang={lang} onChange={p=>upFnd(i,p)} onRemove={()=>setFounders(f=>f.filter((_,j)=>j!==i))}/>)}
            <button onClick={()=>setFounders(f=>[...f,{name:'',country:'Казахстан',role:'CTO',links:[]}])}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:T.accent,background:T.accentBg,border:`1.5px dashed ${T.accentBorder}`,cursor:'pointer',padding:'10px 18px',borderRadius:12,fontFamily:'inherit',fontWeight:600,width:'100%',justifyContent:'center',transition:'all .15s'}}
              onMouseOver={e=>e.currentTarget.style.background='rgba(29,107,252,.12)'} onMouseOut={e=>e.currentTarget.style.background=T.accentBg}>
              <IPlus sz={14} col={T.accent}/>{lang==='ru'?'Добавить со-фаундера':'Add co-founder'}
            </button>
          </AccordionSection>

          {/* Section 3: Data Room */}
          <AccordionSection
            title={t.docSection}
            subtitle={`${t.docSub} · ${lang==='ru'?'Адаптировано':'Adapted'}: ${sk==='seed'?'Seed':'Pre-seed'}`}
            open={sections.dataroom}
            onToggle={()=>toggleSection('dataroom')}
            accentColor="#7c3aed">

            {/* Mandatory — auto-opens, no toggle arrow */}
            <div style={{border:`1.5px solid ${T.redBorder}`,borderRadius:14,overflow:'hidden',marginBottom:14}}>
              <div style={{padding:'12px 18px',background:'linear-gradient(135deg,#fff5f5,#fff8f8)',borderBottom:`1px solid ${T.redBorder}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:T.red,letterSpacing:'.1em',marginBottom:2}}>{t.mandatory}</div>
                  <div style={{fontSize:11,color:T.textSubtle}}>Pitch Deck · Субдокументы · Финансовая модель</div>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:canSub?T.green:T.red}}>{reqIds.filter(id=>docs[id]).length}/{reqIds.length}</span>
              </div>
              <div style={{padding:16}}>
                <DropZone id="pitch" doc={pitchDoc} val={docs.pitch} onUp={upDoc} lang={lang} t={t} onAsk={openAI}/>
                <div style={{marginTop:14}}>
                  <div style={{fontSize:10,fontWeight:700,color:T.textSubtle,letterSpacing:'.12em',textTransform:'uppercase',textAlign:'center',padding:'7px 0',borderBottom:`1px solid ${T.borderLight}`,marginBottom:2}}>{lang==='ru'?'СУБДОКУМЕНТЫ К PITCH DECK':'SUBDOCUMENTS TO PITCH DECK'}</div>
                  {['mkt','tech','unit','founders','cap','val'].map(id=>(
                    <SlotRow key={id} id={id} doc={SD[id]} val={docs[id]} status={gs(SD[id])} onUp={upDoc} lang={lang} t={t} onAsk={openAI}/>
                  ))}
                </div>
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.borderLight}`}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                    {t.finModel}<span style={{fontSize:10,color:T.green,background:T.greenBg,border:`1px solid ${T.greenBorder}`,padding:'1px 8px',borderRadius:5,fontWeight:700}}>Excel</span>
                  </div>
                  <SlotRow id="fin" doc={SD.fin} val={docs.fin} status={gs(SD.fin)} onUp={upDoc} lang={lang} t={t} onAsk={openAI}/>
                </div>
              </div>
            </div>

            {/* Product Demo — sub-accordion */}
            <SubAccordion
              title={t.productDemo}
              subtitle={t.productDemoSub}
              open={drSubs.demo}
              onToggle={()=>setDrSubs(s=>({...s,demo:!s.demo}))}
              color={T.purple}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
                <div style={{border:`1.5px solid ${T.accentBorder}`,borderRadius:12,overflow:'hidden'}}>
                  <div style={{padding:'9px 13px',background:T.accentBg,borderBottom:`1px solid ${T.accentBorder}`,display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:T.accent}}>{t.accessLabel}</span>
                    {sk==='seed'&&<span style={{fontSize:10,color:T.accent,background:'#fff',border:`1px solid ${T.accentBorder}`,padding:'1px 7px',borderRadius:5,marginLeft:'auto'}}>{t.accessSub}</span>}
                  </div>
                  <div style={{padding:11,display:'flex',flexDirection:'column',gap:8}}>
                    <input style={{...inp,fontSize:12}} placeholder="URL продукта" onChange={e=>upDoc('prod_url',e.target.value)}/>
                    <input style={{...inp,fontSize:12}} placeholder={lang==='ru'?'Логин / Email':'Login / Email'} onChange={e=>upDoc('prod_login',e.target.value)}/>
                    <input style={{...inp,fontSize:12}} type="password" placeholder={lang==='ru'?'Пароль':'Password'} onChange={e=>upDoc('prod_pass',e.target.value)}/>
                    <p style={{fontSize:10,color:T.textSubtle,margin:0}}>⚠ {lang==='ru'?'Credentials удаляются после анализа':'Credentials deleted after analysis'}</p>
                  </div>
                </div>
                <div style={{border:`1.5px solid ${T.purpleBorder}`,borderRadius:12,overflow:'hidden'}}>
                  <div style={{padding:'9px 13px',background:T.purpleBg,borderBottom:`1px solid ${T.purpleBorder}`,display:'flex',alignItems:'center',gap:6}}>
                    <IVideo sz={13} col={T.purple}/>
                    <span style={{fontSize:12,fontWeight:700,color:T.purple}}>{t.videoLabel}</span>
                    <span style={{fontSize:10,color:T.purple,background:'#fff',border:`1px solid ${T.purpleBorder}`,padding:'1px 7px',borderRadius:5,marginLeft:'auto'}}>{t.videoSub}</span>
                  </div>
                  <div style={{padding:11}}>
                    {docs.video?(
                      <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:T.greenBg,borderRadius:9,border:`1px solid ${T.greenBorder}`}}>
                        <ICheck sz={13}/><span style={{fontSize:12,color:T.green,fontWeight:600,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{docs.video}</span>
                        <label style={{fontSize:11,color:T.textMuted,cursor:'pointer'}}>{t.replace}<input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)upDoc('video',f.name)}}/></label>
                      </div>
                    ):(
                      <label style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:7,height:82,border:`2px dashed ${T.purpleBorder}`,borderRadius:10,cursor:'pointer',background:'#fdf8ff'}}>
                        <IUpload sz={18} col={T.purple}/>
                        <span style={{fontSize:11,color:T.purple,textAlign:'center'}}>{lang==='ru'?'Видео — перетащите':'Video — drag or click'}</span>
                        <input type="file" accept="video/*" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)upDoc('video',f.name)}}/>
                      </label>
                    )}
                    <DocInfo doc={videoDoc} lang={lang} t={t} onAsk={openAI}/>
                  </div>
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <label style={lbl}>{t.publicLink} <span style={{fontSize:10,color:T.textSubtle,background:'#F5F5F7',padding:'1px 7px',borderRadius:4,fontWeight:500,textTransform:'lowercase',letterSpacing:0}}>{t.publicLinkSub}</span></label>
                <input style={{...inp,borderColor:pubUrl?T.green:T.border}} value={pubUrl} onChange={e=>{setPubUrl(e.target.value);upDoc('public_url',e.target.value);}} placeholder="https://app.yourproduct.kz"/>
              </div>
              <SlotRow id="rounds" doc={roundsDoc} val={docs.rounds} status="optional" onUp={upDoc} lang={lang} t={t} onAsk={openAI} firstRound={fr} onFR={()=>setFr(v=>!v)}/>
            </SubAccordion>

            {/* Legal Pack — sub-accordion */}
            <SubAccordion
              title={t.legalPack}
              subtitle={t.legalPackSub}
              open={drSubs.legal}
              onToggle={()=>setDrSubs(s=>({...s,legal:!s.legal}))}
              color={T.green}>
              <div>
                {LEGAL.map((item,idx)=>{
                  const label2=lang==='ru'?item.labelRu:item.labelEn;
                  const filled2=Boolean(docs[item.id]);
                  return(
                    <div key={item.id} style={{borderTop:idx>0?`1px solid ${T.borderLight}`:'none',padding:'11px 0'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                        <div style={{width:26,height:26,borderRadius:8,background:filled2?T.greenBg:'#F5F5F7',border:`1px solid ${filled2?T.greenBorder:T.border}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2}}>
                          {filled2?<ICheck sz={12}/>:item.id==='ip'?<IKey sz={12}/>:<IShield sz={12} col={T.textSubtle}/>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                            <span style={{fontSize:13,fontWeight:600,color:T.text}}>{label2}</span>
                            <span style={{fontSize:10,color:T.textSubtle,background:'#F3F1EC',padding:'1px 6px',borderRadius:4}}>{t.optional}</span>
                          </div>
                          {docs[item.id]&&<div style={{fontSize:11,color:T.textSubtle,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{docs[item.id]}</div>}
                          <DocInfo doc={item} lang={lang} t={t} onAsk={openAI}/>
                        </div>
                        <div style={{flexShrink:0}}>
                          <label style={{fontSize:11,padding:'6px 12px',borderRadius:9,background:filled2?'#fff':T.green,color:filled2?T.textMuted:'#fff',cursor:'pointer',fontWeight:700,fontFamily:'inherit',border:`1.5px solid ${filled2?T.border:T.green}`,display:'block',transition:'all .15s',whiteSpace:'nowrap'}}
                            onMouseOver={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.12)'} onMouseOut={e=>e.currentTarget.style.boxShadow='none'}>
                            {filled2?t.replace:t.upload}<input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)upDoc(item.id,f.name)}}/>
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SubAccordion>

          </AccordionSection>

          {/* Submit */}
          <div style={{background:'#fff',borderRadius:16,border:`1.5px solid ${canSub?T.accentBorder:T.border}`,padding:'20px 24px',textAlign:'center',boxShadow:canSub?'0 4px 20px rgba(29,107,252,.12)':'none',transition:'all .3s'}}>

            {/* Results panel — shows after successful analysis */}
            {submitPhase==='done'&&runResult&&(
              <div style={{marginBottom:16,padding:'16px 20px',background:T.greenBg,border:`1.5px solid ${T.greenBorder}`,borderRadius:12,textAlign:'left'}}>
                <div style={{fontSize:14,fontWeight:700,color:T.green,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                  <ICheck sz={16} col={T.green}/>
                  {lang==='ru'?'Анализ завершён':'Analysis complete'}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8}}>
                  {(runResult.tasks||[]).map(task=>(
                    <div key={task.id} style={{background:'#fff',border:`1px solid ${task.status==='completed'?T.greenBorder:task.status==='failed'?T.redBorder:T.border}`,borderRadius:9,padding:'8px 12px'}}>
                      <div style={{fontSize:11,fontWeight:700,color:task.status==='completed'?T.green:task.status==='failed'?T.red:T.textSubtle,marginBottom:2}}>{task.agent_role||'Agent'}</div>
                      <div style={{fontSize:10,color:T.textSubtle}}>{task.status==='completed'?'✓ Done':task.status==='failed'?'✗ Failed':task.status}</div>
                      {task.rca_mode&&<div style={{fontSize:10,color:T.accent,marginTop:2}}>RCA: {task.rca_mode}</div>}
                    </div>
                  ))}
                </div>
                <div style={{marginTop:10,fontSize:11,color:T.textMuted,display:'flex',flexWrap:'wrap',gap:10,alignItems:'center'}}>
                  <span>Run ID: <code style={{background:'#f1f5f9',padding:'1px 6px',borderRadius:4,fontSize:10}}>{runResult.id}</code></span>
                  {runResult.faa_eligible&&<span style={{color:T.accent}}>• FAA eligible</span>}
                  {runResult.rca_triggered&&<span style={{color:T.purple}}>• RCA triggered</span>}
                </div>
              </div>
            )}

            {/* Error panel */}
            {submitPhase==='error'&&submitError&&(
              <div style={{marginBottom:16,padding:'12px 16px',background:T.redBg,border:`1.5px solid ${T.redBorder}`,borderRadius:12,textAlign:'left',fontSize:13,color:T.red}}>
                <strong>{lang==='ru'?'Ошибка отправки:':'Submission error:'}</strong> {submitError}
                <div style={{marginTop:6,fontSize:11,color:T.textMuted}}>
                  {lang==='ru'
                    ?'Убедитесь, что Python backend запущен: cd activatVC-agents-platform && uvicorn app.main:app --port 8000'
                    :'Make sure Python backend is running: cd activatVC-agents-platform && uvicorn app.main:app --port 8000'}
                </div>
              </div>
            )}

            {/* Spinner animation style */}
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

            {/* Analyzing progress */}
            {submitPhase==='analyzing'&&(
              <div style={{marginBottom:12,display:'flex',alignItems:'center',gap:10,justifyContent:'center',color:T.accent,fontSize:13,fontWeight:500}}>
                <span style={{display:'inline-block',width:14,height:14,border:`2px solid ${T.accent}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                {lang==='ru'?'Агенты анализируют заявку…':'Agents are analyzing your application…'}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSub||submitting}
              style={{display:'inline-flex',alignItems:'center',gap:10,padding:'14px 40px',borderRadius:13,
                background:canSub&&!submitting?`linear-gradient(135deg,${T.accent},#6366f1)`:'#D1D5DB',
                border:'none',color:'#fff',fontSize:15,fontWeight:700,
                cursor:canSub&&!submitting?'pointer':'not-allowed',fontFamily:'inherit',
                boxShadow:canSub&&!submitting?'0 6px 22px rgba(29,107,252,.4)':'none',
                transition:'all .2s',letterSpacing:'-0.2px'}}
              onMouseOver={e=>{if(canSub&&!submitting){e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 10px 32px rgba(29,107,252,.5)';}}}
              onMouseOut={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow=canSub&&!submitting?'0 6px 22px rgba(29,107,252,.4)':'none';}}>
              {submitting
                ?<span style={{display:'inline-block',width:17,height:17,border:'2px solid #fff',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                :<IRocket sz={17}/>}
              {submitting
                ?(submitPhase==='sending'?(lang==='ru'?'Отправка…':'Sending…'):(lang==='ru'?'Анализируем…':'Analyzing…'))
                :(submitPhase==='done'?(lang==='ru'?'Отправить повторно':'Resubmit'):t.submitBtn)}
            </button>
            <div style={{fontSize:12,color:T.textSubtle,marginTop:8}}>{t.submitSub}</div>
            {!canSub&&<div style={{fontSize:11,color:T.red,marginTop:5}}>{lang==='ru'?blocked?'Устраните ошибки Gate Check':'Загрузите все обязательные документы':blocked?'Fix Gate Check errors':'Upload all required documents'}</div>}
          </div>
        </div>

        {/* Right: AI Sidebar */}
        <div style={{width:360,flexShrink:0}}>
          <AIChatSidebar lang={lang} ctx={ctx} extMsg={aiMsg} extKey={aiKey}/>
        </div>
      </div>

      <ToastContainer toasts={toasts} onDismiss={id=>setToasts(t=>t.filter(x=>x.id!==id))}/>
    </div>
  );
}

// ─── InvestorPage — полноценный дашборд инвестора ────────────────────────────

const AGENT_META = {
  'CMO+CCO': { color:'#3b82f6', role:'Chief Marketing & Commercial Officer' },
  'CLO':     { color:'#8b5cf6', role:'Chief Legal Officer' },
  'CFO':     { color:'#f59e0b', role:'Chief Financial Officer' },
  'CPO+CTO': { color:'#16a34a', role:'Chief Product & Technology Officer' },
  'CRO':     { color:'#ef4444', role:'Chief Risk Officer' },
  'CHRO':    { color:'#06b6d4', role:'Chief Human Resources Officer' },
  'FAA':     { color:'#ec4899', role:'Founder Assessment Agent' },
  'RCA':     { color:'#a855f7', role:'Reference Check Agent' },
};

// Парсит Investment Score из текста отчёта агента
function extractScore(content) {
  if (!content) return null;
  const m = content.match(/(?:SCORE[^\d]*|score[^\d]*)(\d{1,3})(?:\/100|\s*\/\s*100)?/i)
    || content.match(/\b(\d{2,3})\s*\/\s*100\b/)
    || content.match(/\*\*(\d{2,3})\*\*/);
  if (m) { const n = parseInt(m[1]); if (n >= 0 && n <= 100) return n; }
  return null;
}

// Средний балл по всем агентам
function calcAvgScore(tasks) {
  const scores = tasks.map(t => extractScore(t.report_content)).filter(s => s !== null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);
}

// Вердикт по баллу
function verdict(score) {
  if (score === null) return { label:'Анализируется', color:'#6b7280', bg:'#f3f4f6' };
  if (score >= 75) return { label:'Одобрено', color:'#16a34a', bg:'#f0fdf4' };
  if (score >= 60) return { label:'Conditional', color:'#92400e', bg:'#fefce8' };
  if (score >= 45) return { label:'На рассмотрении', color:'#1d4ed8', bg:'#eff6ff' };
  return { label:'Отказано', color:'#dc2626', bg:'#fef2f2' };
}

// Мини SVG радар
function RadarChart({ scores }) {
  const cx = 145, cy = 112, maxR = 64;
  const keys = ['CMO+CCO','CLO','CFO','CPO+CTO','CRO','CHRO'];
  // 6 осей, 0°=top, шаг 60°
  const pts = keys.map((k, i) => {
    const angle = (i * 60 - 90) * Math.PI / 180;
    const r = ((scores[k] || 0) / 100) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
  const poly = pts.map(p => p.join(',')).join(' ');

  const gridPts = (frac) => keys.map((_, i) => {
    const angle = (i * 60 - 90) * Math.PI / 180;
    const r = frac * maxR;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');

  const labels = [
    {x:145, y:38, anchor:'middle', text:'CMO+CCO'},
    {x:216, y:82, anchor:'start',  text:'CLO'},
    {x:210, y:150,anchor:'start',  text:'CFO'},
    {x:145, y:195,anchor:'middle', text:'CPO+CTO'},
    {x:72,  y:150,anchor:'end',    text:'CRO'},
    {x:76,  y:82, anchor:'end',    text:'CHRO'},
  ];

  return (
    <svg width="290" height="220" viewBox="0 0 290 220" xmlns="http://www.w3.org/2000/svg">
      <style>{`.rl{font-size:11px;font-family:-apple-system,sans-serif;fill:#6b6b6b}`}</style>
      {[1,.75,.5,.25].map(f => (
        <polygon key={f} points={gridPts(f)} fill="none" stroke="#e5e5e5" strokeWidth="0.75"/>
      ))}
      {keys.map((_,i) => {
        const angle = (i * 60 - 90) * Math.PI / 180;
        return <line key={i} x1={cx} y1={cy} x2={cx+maxR*Math.cos(angle)} y2={cy+maxR*Math.sin(angle)} stroke="#e5e5e5" strokeWidth="0.75"/>;
      })}
      <polygon points={poly} fill="#3b82f6" fillOpacity="0.18" stroke="#3b82f6" strokeWidth="2"/>
      {labels.map((l,i) => <text key={i} x={l.x} y={l.y} textAnchor={l.anchor} className="rl">{l.text}</text>)}
    </svg>
  );
}

function InvestorPage({ go, submissionData }) {
  // submissionData = { co, founders, runResult } или null (открыт напрямую)
  const hasData = submissionData && submissionData.runResult;
  const tasks = hasData ? (submissionData.runResult.tasks || []) : [];
  const co = hasData ? submissionData.co : null;
  const founders = hasData ? submissionData.founders : [];

  // Строим карту score по role
  const scoreMap = {};
  tasks.forEach(t => {
    if (t.agent_role && t.report_content) {
      const s = extractScore(t.report_content);
      if (s !== null) scoreMap[t.agent_role] = s;
    }
  });

  const avgScore = hasData ? calcAvgScore(tasks) : null;
  const verd = verdict(avgScore);
  const companyName = co?.company || 'Стартап';
  const stage = co?.stage || '';

  // Состояние для раскрытых отчётов агентов
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (role) => setExpanded(p => ({...p, [role]: !p[role]}));

  // Воронка sidebar
  const funnelItems = [
    { label:'Все заявки', count:hasData?1:8, dot:null },
    { label:'Готово к решению', count:hasData?(avgScore>=60?1:0):2, dot:null },
    { label:'На доработке', count:0, dot:'#f97316' },
    { label:'Gap Review', count:0, dot:'#f59e0b' },
    { label:'На рассмотрении', count:hasData&&avgScore<60?1:1, dot:'#3b82f6', active:true },
    { label:'Одобрено', count:hasData&&avgScore>=75?1:1, dot:'#16a34a' },
    { label:'WATCH', count:1, dot:'#0e7490' },
    { label:'Отказано', count:0, dot:'#9ca3af' },
  ];

  const ddTasks = tasks.filter(t => Object.keys(AGENT_META).includes(t.agent_role) && t.agent_role !== 'FAA' && t.agent_role !== 'RCA');

  return (
    <div style={{fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',background:'#f1f0ec',color:'#1a1a1a',fontSize:14,lineHeight:1.5,height:'100vh',display:'flex',overflow:'hidden'}}>

      {/* ── SIDEBAR ── */}
      <nav style={{width:224,minWidth:224,background:'#fff',borderRight:'0.5px solid rgba(0,0,0,.1)',display:'flex',flexDirection:'column',height:'100vh',overflowY:'auto'}}>
        <div style={{padding:'20px 20px 14px',borderBottom:'0.5px solid rgba(0,0,0,.1)'}}>
          <div style={{fontSize:10,color:'#9b9b9b',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:2}}>Activat VC</div>
          <div style={{fontSize:19,fontWeight:600}}>VentureIQ</div>
        </div>
        <div style={{display:'flex',borderBottom:'0.5px solid rgba(0,0,0,.1)'}}>
          {[['1','Проектов'],['—','AVG'],[hasData?'100%':'0%','Конв.']].map(([v,l],i)=>(
            <div key={i} style={{flex:1,textAlign:'center',padding:'12px 6px',borderRight:i<2?'0.5px solid rgba(0,0,0,.1)':'none'}}>
              <div style={{fontSize:19,fontWeight:600}}>{v}</div>
              <div style={{fontSize:9,color:'#9b9b9b',textTransform:'uppercase',letterSpacing:'.06em',marginTop:2}}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:10,color:'#9b9b9b',letterSpacing:'.09em',textTransform:'uppercase',padding:'16px 20px 8px'}}>Воронка</div>
        {funnelItems.map((item,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 20px',cursor:'pointer',background:item.active?'#f8f8f7':'transparent'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,flex:1}}>
              {item.dot && <div style={{width:8,height:8,borderRadius:'50%',background:item.dot,flexShrink:0}}/>}
              <span style={{fontSize:13,color:item.active?'#1a1a1a':'#6b6b6b'}}>{item.label}</span>
            </div>
            <span style={{fontSize:11,color:'#6b6b6b',background:'#f8f8f7',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:12,padding:'1px 8px'}}>{item.count}</span>
          </div>
        ))}
        <div style={{marginTop:'auto',borderTop:'0.5px solid rgba(0,0,0,.1)',padding:'14px 20px',display:'flex',flexDirection:'column',gap:8}}>
          <div onClick={()=>go(SC.HOME)} style={{fontSize:13,color:'#6b6b6b',cursor:'pointer',padding:'3px 0'}}>← Главная</div>
          <div onClick={()=>go(SC.FORM)} style={{fontSize:13,color:'#6b6b6b',cursor:'pointer',padding:'3px 0'}}>+ Новая заявка</div>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Topbar */}
        <div style={{background:'#fff',borderBottom:'0.5px solid rgba(0,0,0,.1)',padding:'0 28px',height:50,display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <span style={{fontSize:14,color:'#6b6b6b',cursor:'pointer'}} onClick={()=>go(SC.HOME)}>Dashboard</span>
          <span style={{color:'#9b9b9b',fontSize:12}}>›</span>
          <span style={{fontSize:14,fontWeight:500}}>{companyName}</span>
          {hasData && (
            <span style={{borderRadius:20,padding:'2px 11px',fontSize:12,fontWeight:500,background:verd.bg,color:verd.color,border:`0.5px solid ${verd.color}44`}}>
              {verd.label}
            </span>
          )}
          {!hasData && (
            <span style={{borderRadius:20,padding:'2px 11px',fontSize:12,fontWeight:500,background:'#fefce8',color:'#92400e',border:'0.5px solid #fcd34d'}}>
              Демо
            </span>
          )}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:34,height:34,borderRadius:'50%',background:'#1a1a2e',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:500}}>A</div>
            <div>
              <div style={{fontSize:13,fontWeight:500}}>Investor</div>
              <div style={{fontSize:11,color:'#6b6b6b'}}>Activat VC</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:'24px 28px',display:'flex',flexDirection:'column',gap:20}}>

          {/* ── Нет данных — демо карточка ── */}
          {!hasData && (
            <div style={{background:'#fff',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:12,padding:'32px',textAlign:'center'}}>
              <div style={{fontSize:40,marginBottom:12}}>📋</div>
              <div style={{fontSize:18,fontWeight:600,marginBottom:8}}>Здесь появится отчёт</div>
              <div style={{fontSize:13,color:'#6b6b6b',marginBottom:20,maxWidth:400,margin:'0 auto 20px'}}>
                Заполните форму фаундера и нажмите «Отправить на рассмотрение» — агенты проанализируют проект и результат появится здесь автоматически.
              </div>
              <button onClick={()=>go(SC.FORM)} style={{display:'inline-flex',alignItems:'center',gap:8,padding:'10px 24px',borderRadius:10,background:'linear-gradient(135deg,#1d6bfc,#6366f1)',border:'none',color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer'}}>
                Подать заявку →
              </button>
            </div>
          )}

          {/* ── Project Card ── */}
          {hasData && (
            <div style={{background:'#fff',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:12,padding:'22px 26px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:20}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap'}}>
                    <span style={{fontSize:28,fontWeight:700}}>{companyName}</span>
                    {stage && <span style={{background:'#f8f8f7',color:'#6b6b6b',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:20,padding:'2px 10px',fontSize:12}}>{stage}</span>}
                    {founders[0]?.country && <span style={{background:'#f8f8f7',color:'#6b6b6b',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:20,padding:'2px 10px',fontSize:12}}>{founders[0].country}</span>}
                    <span style={{fontSize:12,color:'#9b9b9b'}}>· только что</span>
                  </div>
                  <div style={{fontSize:13,color:'#6b6b6b',marginBottom:14}}>
                    {co?.desc ? co.desc.slice(0,120) + (co.desc.length > 120 ? '…' : '') : 'Анализ завершён'}
                  </div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
                    {[co?.stage, co?.activity, founders[0]?.country].filter(Boolean).map((tag,i)=>(
                      <span key={i} style={{background:'#f8f8f7',color:'#1a1a1a',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:20,padding:'3px 13px',fontSize:12}}>{tag}</span>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      // Собираем текст отчёта из всех агентов
                      const reportText = tasks.map(t =>
                        `## ${t.agent_role} (${t.agent_name || ''})\n\n${t.report_content || 'Нет данных'}\n\n---\n`
                      ).join('\n');
                      const blob = new Blob([reportText], {type:'text/markdown'});
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `${companyName}_report.md`; a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={{display:'inline-flex',alignItems:'center',gap:7,background:'transparent',border:'1.5px solid #16a34a',color:'#16a34a',borderRadius:8,padding:'7px 16px',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Скачать полный отчёт
                  </button>
                </div>
                {/* Score box */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',minWidth:130,flexShrink:0}}>
                  <div style={{fontSize:56,fontWeight:700,color:'#16a34a',lineHeight:1}}>{avgScore ?? '—'}</div>
                  <div style={{color:'#16a34a',fontSize:13,fontWeight:600,marginTop:2}}>↑ новый</div>
                  <div style={{width:115,marginTop:7}}>
                    <div style={{height:5,background:'#f8f8f7',borderRadius:3}}>
                      <div style={{height:5,background:'#16a34a',borderRadius:3,width:`${avgScore||0}%`}}/>
                    </div>
                  </div>
                  <div style={{fontSize:10,color:'#9b9b9b',textAlign:'right',marginTop:3,letterSpacing:'.04em'}}>INVESTMENT SCORE &nbsp; {avgScore??'—'}/100</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Agent Analysis Card ── */}
          {hasData && ddTasks.length > 0 && (
            <div style={{background:'#fff',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:12,padding:'22px 26px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:4}}>
                <div>
                  <div style={{fontSize:16,fontWeight:500}}>Agent Analysis</div>
                  <div style={{fontSize:12,color:'#6b6b6b',marginBottom:22}}>{ddTasks.length} агентов проанализировали проект</div>
                </div>
              </div>
              <div style={{display:'flex',gap:24,alignItems:'center',flexWrap:'wrap'}}>
                <RadarChart scores={scoreMap}/>
                <div style={{flex:1,minWidth:260,display:'flex',flexDirection:'column',gap:11}}>
                  {ddTasks.map(task => {
                    const meta = AGENT_META[task.agent_role] || {color:'#6b7280',role:''};
                    const score = extractScore(task.report_content);
                    return (
                      <div key={task.id}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <div style={{width:10,height:10,borderRadius:'50%',background:meta.color,flexShrink:0}}/>
                          <div style={{minWidth:100}}>
                            <div style={{fontSize:13,fontWeight:500}}>{task.agent_role}</div>
                            <div style={{fontSize:11,color:'#6b6b6b'}}>{meta.role}</div>
                          </div>
                          <div style={{flex:1,height:5,background:'#f8f8f7',borderRadius:3}}>
                            <div style={{height:5,borderRadius:3,background:meta.color,width:`${score||0}%`,transition:'width .6s'}}/>
                          </div>
                          <div style={{fontSize:13,fontWeight:600,minWidth:26,textAlign:'right',color:meta.color}}>{score ?? '—'}</div>
                          <span
                            onClick={()=>toggleExpand(task.agent_role)}
                            title="Показать отчёт"
                            style={{color:'#9b9b9b',cursor:'pointer',fontSize:13,padding:'2px 4px',userSelect:'none'}}
                          >
                            {expanded[task.agent_role] ? '▲' : '↓'}
                          </span>
                        </div>
                        {/* Раскрытый отчёт агента */}
                        {expanded[task.agent_role] && task.report_content && (
                          <div style={{marginTop:10,marginLeft:20,padding:'14px 16px',background:'#f8fafc',borderRadius:10,border:'1px solid #e2e8f0',fontSize:12,color:'#334155',lineHeight:1.7,maxHeight:400,overflowY:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
                            {task.report_content}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Анализ идёт ── */}
          {hasData && tasks.some(t => t.status === 'running' || t.status === 'pending') && (
            <div style={{background:'#fff',border:'0.5px solid rgba(0,0,0,.1)',borderRadius:12,padding:'22px 26px',display:'flex',alignItems:'center',gap:14}}>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <span style={{display:'inline-block',width:18,height:18,border:'2px solid #1d6bfc',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
              <div>
                <div style={{fontSize:14,fontWeight:500}}>Агенты анализируют проект…</div>
                <div style={{fontSize:12,color:'#6b6b6b'}}>
                  {tasks.filter(t=>t.status==='completed').length} / {tasks.length} завершено
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App(){
  const [screen, setScreen] = useState(SC.HOME);
  // submissionData передаётся из Form в InvestorPage после успешного анализа
  const [submissionData, setSubmissionData] = useState(null);

  function navigate(s, data) {
    if (data) setSubmissionData(data);
    setScreen(s);
  }

  return(
    <div style={{fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif',background:'#fff',minHeight:'100vh',WebkitFontSmoothing:'antialiased'}}>
      {screen===SC.HOME && <Home go={navigate}/>}
      {screen===SC.FORM && <Form go={navigate}/>}
      {screen===SC.INVESTOR && <InvestorPage go={navigate} submissionData={submissionData}/>}
    </div>
  );
}
