(function(){
'use strict';


/* ============================================================
   Guarda a marcação estática da própria página (a folha de estilo e este script) para
   conseguir reemitir um documento completo e válido mais tarde, em persist(), sem ter
   que duplicar o código-fonte em lugar nenhum.
   ============================================================ */
var SELF_SCRIPT_OUTER = document.currentScript.outerHTML;
/* IMPORTANTE: não capture a folha de estilo com document.querySelector('style') em tempo
   de execução. Quando esta página é aberta dentro de um contêiner que injeta um <style>
   de reset próprio antes do nosso, querySelector('style') pega silenciosamente a tag
   errada, e a regravação salvaria um documento sem nenhum CSS (layout quebrado, imagens
   sem limite de tamanho). O CSS real é embutido aqui na montagem, então está sempre
   correto, não importa como a página seja empacotada. */
var APP_CSS_TEXT = /*__APP_CSS__*/"";
var STYLE_OUTER = '<style id="app-style">' + APP_CSS_TEXT + '</style>';
var FONT_LINK_OUTER = (function(){ var l = document.getElementById('gfonts-link'); return l ? l.outerHTML : ''; })();

var RAW = JSON.parse(document.getElementById('data-blob').textContent);
var TODAY = new Date();

var STATE = {
  kpis: RAW.kpis,
  fornecedores: RAW.fornecedores,
  produtos: RAW.produtos,
  tendenciaMensal: RAW.tendenciaMensal,
  gastoPorTipo: RAW.gastoPorTipo,
  fornecedoresMesclados: RAW.fornecedoresMesclados || [],
  reposicaoCandidatos: RAW.reposicaoCandidatos || [],
  periodoDias: RAW.periodoDias || 142,
  avaliacoes: RAW.avaliacoes || {},
  cotacoes: (RAW.cotacoes || []).map(migrateCotacao),
  contratos: RAW.contratos || [],
  configAprovacao: Object.assign({ alcadaValor: 5000, minCotacoesValor: 10000, minCotacoesQtd: 3 }, RAW.configAprovacao || {}),
  configReposicao: RAW.configReposicao || { coberturaDias: 30 },
  pontosPedido: RAW.pontosPedido || {},
  obras: RAW.obras || [],
  estoqueAtual: RAW.estoqueAtual || {},
  atividades: RAW.atividades || [],
  branding: RAW.branding || { logoDataUrl: '' },
  itensPersonalizados: RAW.itensPersonalizados || [],
  pedidos: RAW.pedidos || [],
  pedidosSeq: RAW.pedidosSeq || 0,
  /* Contador usado para gerar códigos de fornecedores cadastrados manualmente (fora do
     ERP) — ver gerarCodigoFornecedor(). */
  fornecedoresSeq: RAW.fornecedoresSeq || 0,
  segundaFonte: RAW.segundaFonte || {},
  /* Identificação da empresa que usa o painel. Fica nos dados, e não escrita no código,
     para o mesmo aplicativo servir a qualquer empresa — o nome é definido na aba Usuários
     e aparece na tela de login, no comparativo e nos relatórios impressos. */
  empresa: Object.assign({ nome:'', endereco:'', cidade:'', uf:'', latitude:null, longitude:null }, RAW.empresa || {}),
  usuarios: RAW.usuarios || [],
  /* Código de cadastro de administrador: quem digita este código (ou um código novo,
     definido depois por um admin já logado, na aba Usuários) na tela de cadastro vira
     administrador; os demais viram operador. Guardamos só o hash SHA-256, nunca o texto,
     então quem olhar o código-fonte desta página não vê o código em si. Código padrão de
     fábrica: "ADMIN-SETUP-2026" — TROQUE na aba Usuários logo depois de criar o primeiro
     administrador, porque este código padrão é público no repositório do projeto. */
  configAuth: Object.assign({ adminCodeHash: '0085faad2f0825a33b773087410786764256c093ec3e8992c6e1861a7fc349a7' }, RAW.configAuth || {}),
  /* Notificações (sino): criadas quando um administrador aceita ou recusa um orçamento, e
     como lembrete diário enquanto um item aprovado ainda não foi marcado como "Realizada".
     Cada notificação pertence a um único usuário (userId) — quem registrou a cotação. */
  notificacoes: RAW.notificacoes || [],
  /* Agendamento de Compras (quadro Kanban): cards de compra que um administrador atribui
     a um operador específico ir comprar. Colunas: pendente / comprando / comprado. */
  agendamentos: RAW.agendamentos || [],
  /* Hora Extra: pedidos de lanche/marmita feitos por um chefe de setor para a equipe que
     está em hora extra; administradores e operadores veem a lista consolidada de todos os
     setores e marcam quando a compra foi feita. */
  horaExtra: RAW.horaExtra || [],
  /* Mapa Comparativo: comparação de fornecedores lado a lado para uma compra específica.
     Cada "fornecedor cotado" é uma proposta recebida (pode estar ligada a um fornecedor do
     ERP pelo campo codigoErp, ou ser um fornecedor novo digitado à mão), e cada proposta
     tem seus produtos com preço, desconto, frete etc. `selecionados` guarda quais itens
     estão no comparativo atual, e `historico` guarda cada comparação já concluída — com o
     vencedor escolhido, a justificativa e a foto de todas as opções na época. */
  comparativo: Object.assign({ fornecedores: [], produtos: {}, selecionados: {}, historico: [], seq: 0 }, RAW.comparativo || {})
};

/* ============================================================
   Autenticação (login/cadastro)
   ============================================================ */
function loadSessionUserId(){
  try { return window.localStorage.getItem('centralCompras_sessionUserId') || ''; } catch(e){ return ''; }
}
function saveSessionUserId(id){
  try {
    if(id){ window.localStorage.setItem('centralCompras_sessionUserId', id); }
    else { window.localStorage.removeItem('centralCompras_sessionUserId'); }
  } catch(e){}
}
function bytesToHex(buf){
  var bytes = new Uint8Array(buf), hex = '';
  for(var i=0;i<bytes.length;i++){ var h = bytes[i].toString(16); hex += h.length<2 ? '0'+h : h; }
  return hex;
}
function sha256Hex(str){
  if(!(window.crypto && window.crypto.subtle)){
    return Promise.reject(new Error('crypto indisponível'));
  }
  return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(bytesToHex);
}
function randomSaltHex(){
  var arr = new Uint8Array(16);
  (window.crypto).getRandomValues(arr);
  return bytesToHex(arr.buffer);
}
function currentUsuario(){
  if(!UI.auth.sessionUserId) return null;
  return STATE.usuarios.find(function(u){ return u.id===UI.auth.sessionUserId; }) || null;
}
function isAdmin(){ var u = currentUsuario(); return !!u && u.papel==='admin'; }
function isChefeSetor(){ var u = currentUsuario(); return !!u && u.papel==='chefe_setor'; }
function contarAdmins(){ return STATE.usuarios.filter(function(u){ return u.papel==='admin'; }).length; }
function papelLabel(papel){ return papel==='admin' ? 'Administrador' : papel==='chefe_setor' ? 'Chefe de Setor' : 'Operador'; }
/* Cadastro (signup) fica em observação até um administrador aprovar ou recusar. Contas
   antigas (de antes desta funcionalidade existir) não têm o campo `status` — tratamos a
   ausência do campo como 'aprovado' (padrão defensivo) para nunca travar quem já tinha
   conta antes desta mudança. */
function usuarioStatus(u){ return (u && u.status) || 'aprovado'; }
/* Nome da empresa para exibir. Fica vazio enquanto ninguém preencheu (aba Usuários); quem
   chama decide se mostra um rótulo neutro ou esconde o trecho inteiro. */
function empresaNome(){ return ((STATE.empresa && STATE.empresa.nome) || '').trim(); }
function encontrarUsuarioPorEmail(email){
  var q = String(email||'').trim().toLowerCase();
  return STATE.usuarios.find(function(u){ return u.email.toLowerCase()===q; }) || null;
}

var UI = {
  tab: 'visao-geral',
  syncState: 'local',
  notifOpen: false,
  lembretesChecados: false,
  fornecedores: { search:'', abc:'todos', sortKey:'spend', sortDir:'desc', limit:60 },
  novoFornecedorAberto: false,
  itens: { search:'', quadrante:'todos', sortKey:'spend', sortDir:'desc', limit:60 },
  cotacoes: { filtro:'abertas', showForm:false, formObraId:'', formObs:'', formSolicitante:'', formSetor:'', formItensCotados:[blankItemCotado()], pendingExceptionId:null, pendingExceptionItemIdx:null, pendingExceptionVencedor:null, exceptionText:'', pendingRejectId:null, pendingRejectItemIdx:null, rejectText:'' },
  comprasPeriodo: { limitSemanas:12, limitMeses:12 },
  pedidos: { filtro:'abertos', limit:60, recebimentoAbertoId:null, recebimentoDraft:{ data:'', qtd:'', notaFiscal:'', problemaQualidade:false, obs:'', anexo:null } },
  reposicao: { search:'', quadrante:'todos', sortKey:'nPedidos', sortDir:'desc', limit:60, estoqueDraft:{}, abaixoPonto:false },
  contratos: { filtro:'todos', showForm:false, formEditId:null, form:{ fornecedorBusca:'', escopo:'', precoBase:'', indice:'IPCA', periodicidade:'anual', dataInicio:'', obs:'', obraId:'' }, anexoDraft:null },
  obras: { showForm:false, formEditId:null, form:{ nome:'', cliente:'', status:'ativa' }, detalheId:null },
  segundaFonte: { editingId:null, draft:{ status:'buscando', fornecedorAlternativo:'', obs:'' } },
  csvExport: { showModal:false, dataset:'fornecedores' },
  editingFornecedor: null,
  auth: {
    sessionUserId: loadSessionUserId(),
    screen: 'login', busy: false,
    loginEmail: '', loginSenha: '', loginErro: '',
    cadNome: '', cadEmail: '', cadRamal: '', cadSenha: '', cadSenha2: '', cadCodigo: '', cadErro: '',
    cadTipo: 'operador'
  },
  usuarios: { editandoCodigoAdmin: false, novoCodigoAdmin: '', pendingRoleOverride: {} },
  agendamento: {
    showForm: false, editingId: null,
    form: blankAgendamentoForm(),
    pendingDeleteId: null,
    expandedIds: {}
  },
  horaExtra: {
    form: blankHoraExtraForm(),
    filtroStatus: 'todos'
  },
  comparativo: {
    aba: null,                 /* id do fornecedor cotado, '__comparar__' ou '__historico__' */
    novoFornecedor: false,     /* formulário "novo fornecedor cotado" aberto na barra de abas */
    buscaErp: '',              /* texto do typeahead que puxa um fornecedor já existente do ERP */
    novoProdutoPara: null,     /* id do fornecedor cujo formulário de novo produto está aberto */
    novoProdutoFoto: null,     /* {dataUrl, nome} da foto escolhida antes de salvar o produto */
    pendingDelete: null,       /* 'forn:<id>' ou 'prod:<fid>:<pid>' aguardando confirmação */
    pickerOpen: {},            /* fornecedorId -> bool (lista de seleção da aba Comparar) */
    detalhe: null,             /* {fid, pid} do modal de detalhe do produto */
    escolha: null,             /* chave "fid|pid" do vencedor escolhido manualmente */
    justificativa: '',
    historicoOpen: {},
    concluidoEm: null
  },
  toasts: []
};
/* Sessão salva de um navegador antigo pode apontar para um usuário que já foi removido
   por um administrador — valida já na carga para não travar numa sessão fantasma. */
if(UI.auth.sessionUserId){
  var sessionUsuarioBoot = STATE.usuarios.find(function(u){ return u.id===UI.auth.sessionUserId; });
  /* Também derruba a sessão salva se, entre uma visita e outra, o administrador recusou
     essa conta (ou a colocou de volta em análise) — nunca deixe uma sessão antiga
     contornar a aprovação. */
  if(!sessionUsuarioBoot || usuarioStatus(sessionUsuarioBoot)!=='aprovado'){
    UI.auth.sessionUserId = ''; saveSessionUserId('');
  }
}

/* ============================================================
   Ponte com o ambiente que hospeda a página
   ------------------------------------------------------------
   O painel roda de duas maneiras. Aberto direto do disco, é um arquivo comum: o que a
   pessoa altera vale enquanto a aba estiver aberta. Publicado num ambiente que ofereça
   serviços à página hospedada, ele ganha duas capacidades — regravar a si mesmo, que é o
   que faz uma alteração valer para a equipe inteira, e entregar arquivos para download.

   Todo o acoplamento com o hospedeiro está nas poucas linhas abaixo. O resto do código só
   pergunta "tenho serviço de gravação?" e segue a vida; se um dia o painel for hospedado
   em outro lugar, é só este bloco que muda.
   ============================================================ */
var servicoGravacao = null;   /* preenchido se o hospedeiro permitir regravar a página */
var hostVerificado = false;   /* já sabemos se há serviço, ou ainda estamos perguntando? */

/* Resolvido a cada chamada, e não guardado numa variável na carga: alguns hospedeiros só
   publicam a ponte depois que o script da página já rodou, e um valor capturado cedo
   demais ficaria nulo para sempre. */
function host(){
  return (window.claude && typeof window.claude.use === 'function') ? window.claude : null;
}
function pedirServico(nome){
  var h = host();
  if(!h) return Promise.resolve(null);
  try {
    return Promise.resolve(h.use(nome)).then(function(s){ return s || null; },
                                             function(){ return null; });
  } catch(err){ return Promise.resolve(null); }
}

if(host()){
  pedirServico('artifact').then(function(api){
    servicoGravacao = api; hostVerificado = true; render();
  });
} else {
  hostVerificado = true;
}

/* ============================================================
   Formatters
   ============================================================ */
var fmtBRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 });
var fmtBRLcents = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:2 });
var fmtInt = new Intl.NumberFormat('pt-BR');
var fmtPct = function(v, digits){ return v.toLocaleString('pt-BR', { minimumFractionDigits: digits==null?1:digits, maximumFractionDigits: digits==null?1:digits }) + '%'; };
function money(v){ return fmtBRL.format(v||0); }
function moneyCents(v){ return fmtBRLcents.format(v||0); }
function num(v){ return fmtInt.format(v||0); }
function num1(v){ return (v||0).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}); }
function dateBR(iso){ if(!iso) return '—'; var p = iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }
function todayISO(){ return TODAY.toISOString().slice(0,10); }
function addMonths(iso, n){
  var d = new Date(iso+'T12:00:00');
  var targetMonth = d.getMonth()+n;
  var origDay = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  var daysInTarget = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(origDay, daysInTarget));
  return d.toISOString().slice(0,10);
}
function daysUntil(iso){
  if(!iso) return null;
  var d = new Date(iso+'T12:00:00');
  return Math.round((d-TODAY)/86400000);
}
function addDays(iso, n){
  var d = new Date(iso+'T12:00:00');
  d.setDate(d.getDate()+(n||0));
  return d.toISOString().slice(0,10);
}
function monthLabel(ym){
  var meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  var parts = ym.split('-'); return meses[parseInt(parts[1],10)-1] + '/' + parts[0].slice(2);
}
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function titleCase(s){
  s = String(s||'').trim().toLowerCase();
  return s.replace(/\w\S*/g, function(t){ return t.charAt(0).toUpperCase()+t.substr(1); });
}
function normalize(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function parseNum(v){ v = (v+'').replace(/\./g,'').replace(',', '.'); var n = parseFloat(v); return isNaN(n)?0:n; }

var TIPO_LABELS = {
  MP:'Matéria-prima', MC:'Material de consumo', SV:'Serviço', GN:'Insumos gerais',
  OI:'Outros insumos', PA:'Peças/componentes', II:'Manutenção/rolamentos', ME:'Material diverso',
  GG:'Brindes', KT:'EPI/kits'
};
function tipoLabel(t){ if(!t) return 'Sem categoria'; return TIPO_LABELS[t] || t; }

var QUAD_LABELS = { estrategico: 'Estratégico', alavancagem: 'Alavancagem', gargalo: 'Gargalo', rotina: 'Rotina' };
var QUAD_DESC = {
  estrategico: 'Alto gasto e poucos fornecedores — risco real de desabastecimento. Priorize contrato e segundo fornecedor.',
  alavancagem: 'Alto gasto, vários fornecedores — use o volume para negociar preço e prazo.',
  gargalo: 'Baixo gasto mas fornecimento concentrado — risco desproporcional ao valor. Vale ter alternativa cadastrada.',
  rotina: 'Baixo gasto e fácil de repor — automatize a reposição e não gaste tempo de comprador aqui.'
};
var INDICES = { IPCA:'IPCA', IGPM:'IGP-M', INCC:'INCC', CRU_ACO:'CRU (aço)', NENHUM:'Sem reajuste' };
var PERIODICIDADES = { mensal:['Mensal',1], trimestral:['Trimestral',3], semestral:['Semestral',6], anual:['Anual',12] };

/* ============================================================
   Icons
   ============================================================ */
var ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.25" y="3.25" width="7.5" height="9.5"/><rect x="13.25" y="3.25" width="7.5" height="5.5"/><rect x="13.25" y="12.25" width="7.5" height="8.5"/><rect x="3.25" y="15.25" width="7.5" height="5.5"/></svg>',
  factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V10.5L8 13.5V10.5L13 13.5V10.5L18 13.5V21"/><path d="M18 8.5V6l2.5 1.8V13"/><line x1="2.5" y1="21" x2="21.5" y2="21"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.3 19.5 7.5v9L12 20.7 4.5 16.5v-9L12 3.3Z"/><path d="M4.7 7.4 12 11.5l7.3-4.1"/><line x1="12" y1="11.5" x2="12" y2="20.7"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="5" y1="7" x2="19" y2="7"/><path d="M5 7 2.3 12.6a2.85 2.85 0 0 0 5.4 0L5 7Z"/><path d="M19 7l-2.7 5.6a2.85 2.85 0 0 0 5.4 0L19 7Z"/><path d="M9 21h6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.05 3.7 2.6 19a1 1 0 0 0 .87 1.5h17.06a1 1 0 0 0 .87-1.5L12.95 3.7a1 1 0 0 0-1.9 0Z"/><line x1="12" y1="9.5" x2="12" y2="13.8"/><circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.8l2.85 6.06 6.65.75-4.95 4.55 1.32 6.6L12 17.5l-5.87 3.26 1.32-6.6-4.95-4.55 6.65-.75Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.6c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1V7"/><path d="M6 7l1 12.4c0 .9.8 1.6 1.7 1.6h6.6c.9 0 1.7-.7 1.7-1.6L18 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.9-5.4L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.9 5.4L4 15.5"/><path d="M4 20v-4.5h4.5"/></svg>',
  contract: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h8l3.5 3.5V20a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v3.6c0 .5.4.9.9.9H18.5"/><line x1="8" y1="12" x2="15.5" y2="12"/><line x1="8" y1="15.3" x2="13.5" y2="15.3"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.3" width="18" height="12.7" rx="1.6"/><path d="M8.3 7.3V5.6c0-.7.6-1.3 1.3-1.3h4.8c.7 0 1.3.6 1.3 1.3v1.7"/><line x1="3" y1="12.5" x2="21" y2="12.5"/><path d="M10.3 12.5v1.7h3.4v-1.7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 19.5 6v6c0 5-3.2 8.2-7.5 9.8C7.7 20.2 4.5 17 4.5 12V6L12 3.2Z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.7"/><path d="M12 7.2V12l3.4 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.3" r="3.4"/><path d="M4.8 19.8c1.2-3.5 4-5.3 7.2-5.3s6 1.8 7.2 5.3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15.7 4.2 19.8 8.3 8.6 19.5 4 20.5l1-4.6Z"/><line x1="14" y1="6" x2="18" y2="10"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11.5"/><path d="M7.3 10.3 12 15l4.7-4.7"/><path d="M4.5 18.2v1.3c0 .8.7 1.5 1.5 1.5h12c.8 0 1.5-.7 1.5-1.5v-1.3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.3" y="4.5" width="17.4" height="15" rx="1.6"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17.5l5.2-5.2a1.8 1.8 0 0 1 2.5 0l1.6 1.6"/><path d="M13.5 15.8l2.2-2.2a1.8 1.8 0 0 1 2.5 0l2.3 2.3"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20.5" x2="20.5" y2="20.5"/><rect x="6" y="13" width="3.4" height="7.5"/><rect x="12" y="8.5" width="3.4" height="12"/><rect x="18" y="4.5" width="3.4" height="16"/></svg>',
  package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z"/><path d="M3.5 7.5 12 12l8.5-4.5"/><line x1="12" y1="12" x2="12" y2="21"/></svg>',
  mappin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s7-6.7 7-12.3A7 7 0 0 0 5 9.2c0 5.6 7 12.3 7 12.3Z"/><circle cx="12" cy="9" r="2.6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10.5a6 6 0 0 1 12 0c0 4.2 1.3 5.7 2 6.5H4c.7-.8 2-2.3 2-6.5Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
  kanban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.3" y="4" width="5.4" height="16" rx="1.3"/><rect x="9.3" y="4" width="5.4" height="10.5" rx="1.3"/><rect x="15.3" y="4" width="5.4" height="13.5" rx="1.3"/></svg>',
  food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v7a2.5 2.5 0 0 0 5 0V3"/><line x1="7.5" y1="3" x2="7.5" y2="21"/><path d="M17.5 3c-1.8 0-3 2-3 5.5S15.7 12 17.5 12"/><line x1="17.5" y1="3" x2="17.5" y2="21"/></svg>',
  /* Ícones novos usados pela aba Mapa Comparativo */
  award: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.6" r="5.4"/><path d="M8.6 13.1 7.2 21l4.8-2.7 4.8 2.7-1.4-7.9"/></svg>',
  printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8.5V3.5h10v5"/><path d="M7 18H5a1.6 1.6 0 0 1-1.6-1.6v-5.3A1.6 1.6 0 0 1 5 9.5h14a1.6 1.6 0 0 1 1.6 1.6v5.3A1.6 1.6 0 0 1 19 18h-2"/><rect x="7" y="14.5" width="10" height="6"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 11.1 12 19.5a4.9 4.9 0 0 1-6.9-6.9l8.4-8.4a3.3 3.3 0 0 1 4.6 4.6l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.6 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V8Z"/><path d="M13.6 3v5.1h5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 18.6a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7V8.8a1.7 1.7 0 0 1 1.7-1.7h3.1l1.7-2.5h6l1.7 2.5h3.1a1.7 1.7 0 0 1 1.7 1.7Z"/><circle cx="12" cy="13.3" r="3.4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="5" width="7.2" height="14" rx="1.3"/><rect x="14" y="8" width="7.2" height="11" rx="1.3"/><line x1="12" y1="2.6" x2="12" y2="21.4"/></svg>'
};
function icon(name){ return ICONS[name] || ''; }

/* ============================================================
   Derived helpers
   ============================================================ */
function getAvaliacao(codigo){ return STATE.avaliacoes[codigo] || { nota:0, status:'nao_avaliado', obs:'' }; }
function abcBadge(abc){ if(!abc) return '<span class="badge badge-neutral">Sem classificação</span>'; var cls = abc==='A' ? 'badge-a' : abc==='B' ? 'badge-b' : 'badge-c'; return '<span class="badge '+cls+'">Classe '+esc(abc)+'</span>'; }
function quadTag(q){ return '<span class="quad-tag quad-'+q+'"><span class="quad-dot"></span>'+QUAD_LABELS[q]+'</span>'; }
function statusBadge(status){
  if(status==='homologado') return '<span class="badge badge-good">Homologado</span>';
  if(status==='avaliacao') return '<span class="badge badge-warn">Em avaliação</span>';
  if(status==='bloqueado') return '<span class="badge badge-crit">Bloqueado</span>';
  return '<span class="badge badge-neutral">Não avaliado</span>';
}

function filteredFornecedores(){
  var f = UI.fornecedores;
  var list = STATE.fornecedores.slice();
  if(f.search){ var q = normalize(f.search); list = list.filter(function(s){ return normalize(s.nome).indexOf(q)>=0 || normalize(s.codigo).indexOf(q)>=0 || (s.codigosMesclados||[]).some(function(c){return c.indexOf(q)>=0;}); }); }
  if(f.abc!=='todos'){ list = list.filter(function(s){ return s.abc===f.abc; }); }
  list.sort(function(a,b){ var k=f.sortKey, dir = f.sortDir==='asc'?1:-1; var va=a[k], vb=b[k]; if(typeof va==='string') return va.localeCompare(vb)*dir; return (va-vb)*dir; });
  return list;
}
function filteredProdutos(){
  var f = UI.itens;
  var list = produtosAtivos().slice();
  if(f.search){ var q = normalize(f.search); list = list.filter(function(p){ return normalize(p.descricao).indexOf(q)>=0 || normalize(p.codigo).indexOf(q)>=0; }); }
  if(f.quadrante!=='todos'){ list = list.filter(function(p){ return p.quadrante===f.quadrante; }); }
  list.sort(function(a,b){ var k=f.sortKey, dir = f.sortDir==='asc'?1:-1; var va=a[k], vb=b[k]; if(typeof va==='string') return va.localeCompare(vb)*dir; return (va-vb)*dir; });
  return list;
}
function filteredReposicao(){
  var f = UI.reposicao;
  var list = STATE.reposicaoCandidatos.slice();
  if(f.search){ var q = normalize(f.search); list = list.filter(function(p){ return normalize(p.descricao).indexOf(q)>=0 || normalize(p.codigo).indexOf(q)>=0; }); }
  if(f.quadrante!=='todos'){ list = list.filter(function(p){ return p.quadrante===f.quadrante; }); }
  if(f.abaixoPonto){
    list = list.filter(function(p){
      var e = getEstoque(p.codigo);
      if(!e || e.qtd==null) return false;
      return e.qtd < pontoPedidoQtd(p);
    });
  }
  list.sort(function(a,b){ var k=f.sortKey, dir = f.sortDir==='asc'?1:-1; var va=a[k], vb=b[k]; if(typeof va==='string') return va.localeCompare(vb)*dir; return (va-vb)*dir; });
  return list;
}
function pontoPedidoQtd(p){
  var cobertura = STATE.configReposicao.coberturaDias || 30;
  return (p.consumoMedioMensal/30.44) * cobertura;
}
function produtoTypeaheadResults(q){
  if(!q || q.length<2) return [];
  var qq = normalize(q); var out = [];
  var produtos = produtosAtivos();
  for(var i=0;i<produtos.length;i++){
    var p = produtos[i];
    if(normalize(p.descricao).indexOf(qq)>=0 || normalize(p.codigo).indexOf(qq)>=0){ out.push(p); if(out.length>=18) break; }
  }
  return out;
}
/* Itens personalizados: qualquer descrição digitada livremente numa cotação que não
   corresponda a um item do catálogo histórico é lembrada aqui, para sugerir de novo
   nas próximas cotações ("vão salvando automaticamente para a próxima compra"). */
function registerItemPersonalizado(descricao){
  descricao = (descricao||'').trim();
  if(!descricao) return;
  var qn = normalize(descricao);
  var existente = STATE.itensPersonalizados.find(function(it){ return normalize(it.descricao)===qn; });
  if(existente){
    existente.ultimoUso = new Date().toISOString();
    existente.vezesUsado = (existente.vezesUsado||1) + 1;
  } else {
    STATE.itensPersonalizados.push({ descricao: descricao, criadoEm: new Date().toISOString(), ultimoUso: new Date().toISOString(), vezesUsado: 1 });
  }
}
function itemPersonalizadoTypeaheadResults(q, jaEmCatalogo){
  if(!q || q.length<2) return [];
  var qq = normalize(q);
  return STATE.itensPersonalizados.filter(function(it){
    if(normalize(it.descricao).indexOf(qq)<0) return false;
    if(jaEmCatalogo && jaEmCatalogo.indexOf(normalize(it.descricao))>=0) return false;
    return true;
  }).sort(function(a,b){ return (b.vezesUsado||0)-(a.vezesUsado||0); }).slice(0,8);
}
function fornecedorTypeaheadResults(q){
  if(!q || q.length<2) return [];
  var qq = normalize(q); var out = [];
  for(var i=0;i<STATE.fornecedores.length;i++){
    var s = STATE.fornecedores[i];
    if(normalize(s.nome).indexOf(qq)>=0){ out.push(s); if(out.length>=12) break; }
  }
  return out;
}
function priceVariationOpportunities(){
  return produtosAtivos().filter(function(p){ return p.spend>2000 && p.nPedidos>=2 && p.variacaoPct>10 && p.variacaoPct<1000; })
    .sort(function(a,b){ return b.variacaoPct - a.variacaoPct; }).slice(0,10);
}
function possibleDataErrors(){
  return produtosAtivos().filter(function(p){ return p.spend>500 && p.variacaoPct>=1000; }).sort(function(a,b){ return b.variacaoPct - a.variacaoPct; }).slice(0,6);
}
function topStrategicSingleSource(){
  return produtosAtivos().filter(function(p){ return p.quadrante==='estrategico'; }).sort(function(a,b){ return b.spend - a.spend; }).slice(0,10);
}
function paretoSuppliers(){ return STATE.fornecedores.filter(function(s){ return s.abc==='A'; }).sort(function(a,b){ return b.spend-a.spend; }); }
function contratosAtencao(){
  return STATE.contratos.filter(function(c){ return c.status!=='encerrado'; }).map(function(c){
    var d = daysUntil(c.proximoReajuste);
    return { c: c, dias: d };
  }).filter(function(x){ return x.dias!=null && x.dias<=30; }).sort(function(a,b){ return a.dias-b.dias; });
}
/* Cotações: cada cotação pode ter múltiplos itens (cot.itensCotados), cada um com seu próprio
   status/vencedor/linhas de fornecedor. Registros antigos (um item por cotação) são migrados
   para essa forma logo no carregamento — ver migrateCotacao().
   Política: todo item precisa de no mínimo MIN_ORCAMENTOS orçamentos completos (fornecedor,
   preço e foto do item) antes de poder ser registrado — ver validação em btn-salvar-cotacao.
   Quem decide qual orçamento aceitar (ou recusar a cotação inteira) é sempre um administrador. */
var MIN_ORCAMENTOS = 3;
function blankOrcamentoLinha(){ return { fornecedor:'', preco:'', prazo:'', foto:null, fotoNome:null }; }
function blankItemCotado(){
  var linhas = [];
  for(var i=0;i<MIN_ORCAMENTOS;i++){ linhas.push(blankOrcamentoLinha()); }
  return { itemBusca:'', itemSel:null, qtd:'', unidade:'', linhas: linhas };
}

/* ============================================================
   Agendamento de Compras (Kanban) e Hora Extra: formulários em branco
   ============================================================ */
function blankAgendamentoForm(){
  return { foto:null, fotoNome:'', produto:'', quantidade:'', unidade:'un', fornecedor:'', explicacao:'', responsavelUserId:'' };
}
function blankHoraExtraForm(){
  return { setor:'', responsavelSolicitante:'', pessoas:[{nome:'', horario:'15:00'}], observacao:'' };
}
/* Normaliza uma entrada de pessoa em hora extra: dados antigos podiam ser uma
   string simples com o nome (sem horário) — tratamos como até 15:00 (lanche +
   marmita) para não travar a tela com dado legado. */
function heNormPessoa(p){
  if(typeof p==='string') return { nome:p, horario:'15:00' };
  return { nome:(p&&p.nome)||'', horario:(p&&p.horario==='12:00')?'12:00':'15:00' };
}
/* Pessoas preenchidas (nome não vazio), já normalizadas e com nome aparado —
   é isso que efetivamente conta para lanches/marmitas e é o que é salvo. */
function heFilledPessoas(pessoas){
  return (pessoas||[]).map(heNormPessoa).map(function(p){ return { nome:p.nome.trim(), horario:p.horario }; }).filter(function(p){ return p.nome.length>0; });
}
function heCounts(pessoasPreenchidas){
  return {
    lanches: pessoasPreenchidas.length,
    marmitas: pessoasPreenchidas.filter(function(p){ return p.horario==='15:00'; }).length
  };
}

/* ============================================================
   Notificações (sino): avisam quem registrou a cotação sobre a decisão do
   administrador, e lembram diariamente enquanto um item aprovado não é
   marcado como "Realizada".
   ============================================================ */
var ACOMPANHAMENTO_LABEL = { pendente:'Pendente', em_andamento:'Em andamento', realizada:'Realizada' };
function criarNotificacao(userId, tipo, cot, item, idx){
  /* Cotações antigas (de antes do login) não têm autor conhecido — não há para quem notificar. */
  if(!userId) return;
  STATE.notificacoes.unshift({
    id: 'notif_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    userId: userId, tipo: tipo, cotacaoId: cot.id, itemIdx: idx,
    itemDescricao: item.itemDescricao, criadoEm: new Date().toISOString(), lida: false
  });
  if(STATE.notificacoes.length>300) STATE.notificacoes.length = 300;
}
function notificacoesDoUsuario(){
  var u = currentUsuario(); if(!u) return [];
  return STATE.notificacoes.filter(function(n){ return n.userId===u.id; })
    .slice().sort(function(a,b){ return b.criadoEm.localeCompare(a.criadoEm); });
}
function notificacoesNaoLidasCount(){ return notificacoesDoUsuario().filter(function(n){ return !n.lida; }).length; }
/* Chamada uma vez por sessão (ver render()): gera um lembrete por dia civil para cada item
   aprovado que ainda não foi marcado como "Realizada", enquanto a cotação tiver um autor
   conhecido. Como o painel não tem um servidor rodando em segundo plano, o "diário" aqui
   significa: a cada novo dia em que alguém abrir o painel, um lembrete novo é gerado. */
function gerarLembretesDiarios(){
  var hoje = todayISO();
  var criados = 0;
  STATE.cotacoes.forEach(function(cot){
    if(!cot.criadoPorUserId) return;
    (cot.itensCotados||[]).forEach(function(item, idx){
      if(item.status==='aprovada' && item.acompanhamento!=='realizada'){
        var jaTem = STATE.notificacoes.some(function(n){
          return n.tipo==='lembrete' && n.cotacaoId===cot.id && n.itemIdx===idx && (n.criadoEm||'').slice(0,10)===hoje;
        });
        if(!jaTem){ criarNotificacao(cot.criadoPorUserId, 'lembrete', cot, item, idx); criados++; }
      }
    });
  });
  return criados;
}
function renderAcompanhamentoChips(cot, item, idx){
  return '<div class="notif-status-row" style="margin-top:8px">'
    + '<span class="footnote" style="margin-right:2px">Acompanhamento:</span>'
    + ['pendente','em_andamento','realizada'].map(function(st){
        return '<button class="chip'+(item.acompanhamento===st?' active':'')+'" data-set-acompanhamento="'+st+'" data-cotacao-id="'+cot.id+'" data-item-idx="'+idx+'">'+ACOMPANHAMENTO_LABEL[st]+'</button>';
      }).join('')
    + '</div>';
}

function cotacaoStatusGeral(cot){
  var itens = cot.itensCotados || [];
  if(itens.some(function(it){ return it.status==='aberta'; })) return 'aberta';
  if(itens.some(function(it){ return it.status==='aguardando_aprovacao'; })) return 'aguardando_aprovacao';
  if(itens.some(function(it){ return it.status==='recusada'; })) return 'recusada';
  return 'aprovada';
}
function itensPendentesAprovacao(){
  /* 'aberta' (fluxo novo: orçamentos+fotos enviados, aguardando o administrador escolher)
     e 'aguardando_aprovacao' (registros antigos) são, na prática, o mesmo estado — item
     ainda sem decisão de um administrador. */
  var out = [];
  STATE.cotacoes.forEach(function(cot){
    (cot.itensCotados||[]).forEach(function(item, idx){ if(item.status==='aberta' || item.status==='aguardando_aprovacao') out.push({ cot:cot, item:item, idx:idx }); });
  });
  return out;
}
function itensAprovados(){
  var out = [];
  STATE.cotacoes.forEach(function(cot){
    (cot.itensCotados||[]).forEach(function(item, idx){ if(item.status==='aprovada') out.push({ cot:cot, item:item, idx:idx }); });
  });
  return out;
}
function cotacoesPendentesAprovacao(){ return itensPendentesAprovacao(); }
function economiaTotal(){
  return itensAprovados().filter(function(x){ return typeof x.item.economiaEstimada==='number'; })
    .reduce(function(a,x){ return a + x.item.economiaEstimada; }, 0);
}
function economiaPositivaCount(){
  return itensAprovados().filter(function(x){ return typeof x.item.economiaEstimada==='number' && x.item.economiaEstimada>0; }).length;
}
function getObra(id){ return STATE.obras.find(function(o){ return o.id===id; }); }
function obraItensAprovados(obraId){
  var out = [];
  STATE.cotacoes.filter(function(c){ return c.obraId===obraId; }).forEach(function(cot){
    (cot.itensCotados||[]).forEach(function(item){ if(item.status==='aprovada') out.push(item); });
  });
  return out;
}
function obraContratosAtivos(obraId){
  return STATE.contratos.filter(function(c){ return c.obraId===obraId && c.status!=='encerrado'; });
}
function itemValorFechado(item){
  if(!item.vencedor) return 0;
  var linha = item.linhas.find(function(l){ return l.fornecedor===item.vencedor; });
  return (item.quantidade||0) * (linha ? parseFloat(linha.preco)||0 : 0);
}
function obraGastoTotal(obraId){
  return obraItensAprovados(obraId).reduce(function(a,item){ return a + itemValorFechado(item); }, 0);
}

/* Compras por período: agrega os itens de cotação já fechados (com vencedor definido),
   usando a data em que foram fechados (fechadoEm) ou, na falta dela (registros antigos),
   a data de criação da cotação. */
function itensFechados(){
  var out = [];
  STATE.cotacoes.forEach(function(cot){
    (cot.itensCotados||[]).forEach(function(item){
      if(item.vencedor && item.status!=='recusada'){ out.push({ cot:cot, item:item }); }
    });
  });
  return out;
}
function compraDataISO(x){ return (x.item.fechadoEm || x.cot.criadoEm).slice(0,10); }
function isoWeekInfo(dateISO){
  var d = new Date(dateISO+'T00:00:00Z');
  var dayIdx = (d.getUTCDay()+6)%7; // segunda=0 ... domingo=6
  var monday = new Date(d.getTime()); monday.setUTCDate(d.getUTCDate()-dayIdx);
  var sunday = new Date(monday.getTime()); sunday.setUTCDate(monday.getUTCDate()+6);
  var thursday = new Date(monday.getTime()); thursday.setUTCDate(monday.getUTCDate()+3);
  var year = thursday.getUTCFullYear();
  var firstThursday = new Date(Date.UTC(year,0,4));
  var fDayIdx = (firstThursday.getUTCDay()+6)%7;
  firstThursday.setUTCDate(firstThursday.getUTCDate()-fDayIdx+3);
  var week = 1 + Math.round((thursday.getTime()-firstThursday.getTime())/(7*24*3600*1000));
  var weekStr = (week<10?'0':'')+week;
  return {
    key: year+'-S'+weekStr,
    label: 'Semana '+weekStr+' — '+dateBR(monday.toISOString().slice(0,10))+' a '+dateBR(sunday.toISOString().slice(0,10))
  };
}
function comprasAgrupadas(porSemana){
  var map = {};
  itensFechados().forEach(function(x){
    var dISO = compraDataISO(x);
    var mesKey = dISO.slice(0,7);
    var info = porSemana ? isoWeekInfo(dISO) : { key: mesKey, label: monthLabel(mesKey) };
    var g = map[info.key];
    if(!g){ g = map[info.key] = { key:info.key, mesKey:mesKey, label:info.label, total:0, n:0, itens:{}, fornecedores:{} }; map[info.key]=g; }
    var v = itemValorFechado(x.item);
    g.total += v; g.n++;
    var itKey = x.item.itemDescricao || '(sem descrição)';
    g.itens[itKey] = (g.itens[itKey]||0) + v;
    var fnKey = x.item.vencedor;
    g.fornecedores[fnKey] = (g.fornecedores[fnKey]||0) + v;
  });
  return Object.keys(map).map(function(k){ return map[k]; }).sort(function(a,b){ return b.key.localeCompare(a.key); });
}
function topDeMapa(mapa, n){
  return Object.keys(mapa).map(function(k){ return { nome:k, total:mapa[k] }; })
    .sort(function(a,b){ return b.total-a.total; }).slice(0, n||1);
}
function comprasPorMes(){
  var byMes = {};
  itensFechados().forEach(function(x){
    var mesKey = compraDataISO(x).slice(0,7);
    if(!byMes[mesKey]) byMes[mesKey] = 0;
    byMes[mesKey] += itemValorFechado(x.item);
  });
  return Object.keys(byMes).sort().map(function(k){ return { mes:k, total:byMes[k] }; });
}
function topItensComprados(n){
  var map = {};
  itensFechados().forEach(function(x){
    var key = x.item.itemDescricao || '(sem descrição)';
    if(!map[key]) map[key] = { descricao:key, total:0, qtd:0, n:0 };
    map[key].total += itemValorFechado(x.item);
    map[key].qtd += (x.item.quantidade||0);
    map[key].n++;
  });
  return Object.keys(map).map(function(k){ return map[k]; }).sort(function(a,b){ return b.total-a.total; }).slice(0, n||10);
}
function topFornecedoresComprados(n){
  var map = {};
  itensFechados().forEach(function(x){
    var key = x.item.vencedor;
    if(!map[key]) map[key] = { nome:key, total:0, n:0 };
    map[key].total += itemValorFechado(x.item);
    map[key].n++;
  });
  return Object.keys(map).map(function(k){ return map[k]; }).sort(function(a,b){ return b.total-a.total; }).slice(0, n||10);
}

/* Matriz de criticidade reconstruída a partir das compras fechadas (itensFechados), já
   que o catálogo histórico (STATE.produtos) foi zerado e as compras novas entram como
   texto livre. Assim que houver histórico suficiente, itens voltam a aparecer aqui. */
function classificarQuadrante(spend, nFornecedores){
  var altoGasto = spend > 2000;
  if(altoGasto && nFornecedores<=1) return 'estrategico';
  if(altoGasto && nFornecedores>1) return 'alavancagem';
  if(!altoGasto && nFornecedores<=1) return 'gargalo';
  return 'rotina';
}
function itensAgregadosCompra(){
  var map = {};
  itensFechados().forEach(function(x){
    var key = itemAggKey({codigo:x.item.itemCodigo, descricao:x.item.itemDescricao});
    var g = map[key];
    if(!g){ g = map[key] = { codigo:x.item.itemCodigo, descricao:x.item.itemDescricao, unidade:x.item.unidade||'', spend:0, nPedidos:0, fornecedoresMap:{}, precos:[] }; }
    var v = itemValorFechado(x.item);
    g.spend += v; g.nPedidos++;
    var linha = (x.item.linhas||[]).find(function(l){ return l.fornecedor===x.item.vencedor; });
    var preco = linha ? (parseFloat(linha.preco)||0) : 0;
    if(preco>0) g.precos.push(preco);
    if(!g.fornecedoresMap[x.item.vencedor]) g.fornecedoresMap[x.item.vencedor] = { nome:x.item.vencedor, precos:[], nPedidos:0 };
    g.fornecedoresMap[x.item.vencedor].nPedidos++;
    if(preco>0) g.fornecedoresMap[x.item.vencedor].precos.push(preco);
  });
  return Object.keys(map).map(function(k){
    var g = map[k];
    var fornecedoresArr = Object.keys(g.fornecedoresMap).map(function(fn){
      var f = g.fornecedoresMap[fn];
      var media = f.precos.length ? f.precos.reduce(function(a,b){return a+b;},0)/f.precos.length : 0;
      return { nome:f.nome, precoMedio:media, nPedidos:f.nPedidos };
    }).sort(function(a,b){ return b.nPedidos-a.nPedidos; });
    var precoMedio = g.precos.length ? g.precos.reduce(function(a,b){return a+b;},0)/g.precos.length : 0;
    var precoMin = g.precos.length ? Math.min.apply(null,g.precos) : 0;
    var precoMax = g.precos.length ? Math.max.apply(null,g.precos) : 0;
    return {
      codigo: g.codigo, descricao: g.descricao, unidade: g.unidade, spend: g.spend, nPedidos: g.nPedidos,
      nFornecedores: fornecedoresArr.length, fornecedores: fornecedoresArr,
      precoMedio: precoMedio, precoMin: precoMin, precoMax: precoMax,
      variacaoPct: precoMin>0 ? ((precoMax-precoMin)/precoMin*100) : 0,
      quadrante: classificarQuadrante(g.spend, fornecedoresArr.length)
    };
  }).sort(function(a,b){ return b.spend-a.spend; });
}
function produtosAtivos(){ return STATE.produtos.length ? STATE.produtos : itensAgregadosCompra(); }

/* Segunda fonte / plano de mitigação para itens de fornecedor único */
function itemAggKey(p){ return p.codigo || ('d:'+normalize(p.descricao)); }
function segundaFonteKey(p){ return itemAggKey(p); }
function getSegundaFonte(p){ return STATE.segundaFonte[segundaFonteKey(p)] || null; }
function segundaFonteLabel(st){ return { buscando:'Buscando alternativa', definida:'Segunda fonte definida', nao_aplicavel:'Não aplicável (fornecedor exclusivo/fabricante)' }[st] || st; }
function segundaFonteBadge(st){ var cls = { buscando:'badge-warn', definida:'badge-good', nao_aplicavel:'badge-neutral' }[st] || 'badge-neutral'; return '<span class="badge '+cls+'">'+segundaFonteLabel(st)+'</span>'; }



function getEstoque(codigo){ return STATE.estoqueAtual[codigo] || null; }
function coberturaRestanteDias(p){
  var e = getEstoque(p.codigo);
  if(!e || !e.qtd) return null;
  var consumoDiario = (p.consumoMedioMensal||0) / 30.44;
  if(consumoDiario<=0) return null;
  return e.qtd / consumoDiario;
}
function fornecedoresSemDueDiligence(){
  var strategicSuppliers = {};
  topStrategicSingleSource().forEach(function(p){
    (p.fornecedores||[]).forEach(function(fn){
      var s = STATE.fornecedores.find(function(x){ return x.nome===fn.nome; });
      if(s) strategicSuppliers[s.codigo] = s;
    });
  });
  return Object.keys(strategicSuppliers).map(function(k){ return strategicSuppliers[k]; }).filter(function(s){
    var av = getAvaliacao(s.codigo);
    var temCert = av.certISO9001 || av.certLaudo || av.certSeguroRC;
    return !av.situacaoFiscal || av.situacaoFiscal==='nao_verificado' || !temCert;
  });
}
function dueDiligencePendente(){ return fornecedoresSemDueDiligence(); }
function logAtividade(acao, detalhe){
  var u = currentUsuario();
  STATE.atividades.unshift({ ts: new Date().toISOString(), acao: acao, detalhe: detalhe||'', autor: u ? u.nomeCompleto : 'Não identificado' });
  if(STATE.atividades.length>200) STATE.atividades.length = 200;
}
function closeCotacaoItem(cotObj, itemIdx, venc, justificativa){
  /* Só um administrador chega até aqui (ver guarda em [data-close-cotacao] e no fluxo de
     exceção) — o clique dele já É a decisão/aprovação, então o item vai direto para
     'aprovada', com autoria registrada. Não existe mais uma segunda etapa de aprovação
     depois de escolhido o orçamento vencedor. */
  var item = cotObj.itensCotados[itemIdx];
  item.vencedor = venc;
  item.fechadoEm = new Date().toISOString();
  var linha = item.linhas.find(function(l){ return l.fornecedor===venc; });
  var valorTotal = (item.quantidade||0) * (linha ? parseFloat(linha.preco)||0 : 0);
  if(justificativa) item.justificativaExcecao = justificativa;
  item.status = 'aprovada';
  item.acompanhamento = 'pendente';
  var doer = currentUsuario();
  item.aprovadoPor = doer ? doer.nomeCompleto : null;
  item.aprovadoEm = new Date().toISOString();
  var produto = item.itemCodigo
    ? STATE.produtos.find(function(p){ return p.codigo===item.itemCodigo; })
    : itensAgregadosCompra().find(function(p){ return !p.codigo && normalize(p.descricao)===normalize(item.itemDescricao); });
  if(produto && produto.variacaoPct<1000 && produto.precoMedio>0 && linha){
    item.economiaEstimada = (produto.precoMedio - (parseFloat(linha.preco)||0)) * (item.quantidade||0);
    item.precoMedioReferencia = produto.precoMedio;
  } else {
    item.economiaEstimada = null;
  }
  if(item.status==='aprovada'){ criarPedidoParaItem(cotObj, item, itemIdx); }
  criarNotificacao(cotObj.criadoPorUserId, 'aprovada', cotObj, item, itemIdx);
}
function itemLabel(item){ return (item.itemCodigo?item.itemCodigo+' — ':'')+titleCase(item.itemDescricao)+(item.unidade?' ('+esc(item.unidade)+')':''); }

/* ============================================================
   Pedidos de compra (gerados automaticamente quando um item de
   cotação é aprovado) + recebimento de mercadoria
   ============================================================ */
function gerarNumeroPedido(){
  STATE.pedidosSeq = (STATE.pedidosSeq||0) + 1;
  return 'PC-' + String(STATE.pedidosSeq).padStart(4,'0');
}
/* Gera um código único para um fornecedor cadastrado manualmente (fora da importação do
   ERP, cujos códigos são numéricos com 6 dígitos). Prefixo "MAN" deixa claro, ao olhar a
   lista, que aquele cadastro não veio do ERP — e evita qualquer colisão com um código do
   ERP que ainda não tenha sido importado. */
function gerarCodigoFornecedor(){
  STATE.fornecedoresSeq = (STATE.fornecedoresSeq||0) + 1;
  var novo = 'MAN' + String(STATE.fornecedoresSeq).padStart(5,'0');
  while(STATE.fornecedores.some(function(s){ return s.codigo===novo; })){
    STATE.fornecedoresSeq++;
    novo = 'MAN' + String(STATE.fornecedoresSeq).padStart(5,'0');
  }
  return novo;
}
function criarPedidoParaItem(cot, item, itemIdx){
  if(item.pedidoId) return; // já emitido
  var linha = (item.linhas||[]).find(function(l){ return l.fornecedor===item.vencedor; });
  var prazo = linha ? (parseInt(linha.prazo,10)||0) : 0;
  var dataEmissaoISO = new Date().toISOString();
  var pedido = {
    id: 'ped_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    numero: gerarNumeroPedido(),
    cotacaoId: cot.id, itemIdx: itemIdx,
    itemCodigo: item.itemCodigo, itemDescricao: item.itemDescricao, unidade: item.unidade||'',
    quantidade: item.quantidade||0,
    fornecedor: item.vencedor,
    precoUnit: linha ? (parseFloat(linha.preco)||0) : 0,
    valorTotal: itemValorFechado(item),
    dataEmissao: dataEmissaoISO,
    prazoAcordado: prazo,
    dataPrevista: prazo>0 ? addDays(dataEmissaoISO.slice(0,10), prazo) : null,
    obraId: cot.obraId||null, solicitante: cot.solicitante||'', setor: cot.setor||'',
    cancelado: false,
    recebimentos: []
  };
  STATE.pedidos.unshift(pedido);
  item.pedidoId = pedido.id;
  logAtividade('Pedido de compra emitido', pedido.numero+' — '+itemLabel(item)+' — '+titleCase(item.vencedor));
}
function qtdRecebidaPedido(p){
  return (p.recebimentos||[]).reduce(function(a,r){ return a + (r.quantidade||0); }, 0);
}
function pedidoStatus(p){
  if(p.cancelado) return 'cancelado';
  var recebida = qtdRecebidaPedido(p);
  if(recebida <= 0){
    if(p.dataPrevista && p.dataPrevista < todayISO()) return 'atrasado';
    return 'aberto';
  }
  if(recebida >= (p.quantidade||0)) return 'recebido_total';
  return 'recebido_parcial';
}
function pedidoStatusLabel(st){
  return { aberto:'Aberto', atrasado:'Atrasado', recebido_parcial:'Recebido parcial', recebido_total:'Recebido total', cancelado:'Cancelado' }[st] || st;
}
function pedidoStatusBadge(st){
  var cls = { aberto:'badge-neutral', atrasado:'badge-crit', recebido_parcial:'badge-warn', recebido_total:'badge-good', cancelado:'badge-neutral' }[st] || 'badge-neutral';
  return '<span class="badge '+cls+'">'+pedidoStatusLabel(st)+'</span>';
}
function pedidosEmAberto(){ return STATE.pedidos.filter(function(p){ var st=pedidoStatus(p); return st==='aberto'||st==='atrasado'||st==='recebido_parcial'; }); }
function pedidosAtrasados(){ return STATE.pedidos.filter(function(p){ return pedidoStatus(p)==='atrasado'; }); }
/* Desempenho do fornecedor (scorecard), calculado a partir dos pedidos + recebimentos já
   registrados. Casamento por nome normalizado, já que o vencedor da cotação é texto livre
   e nem sempre é exatamente o mesmo cadastro de fornecedor. */
function pedidosDoFornecedor(nomeFornecedor){
  var qn = normalize(nomeFornecedor);
  return STATE.pedidos.filter(function(p){ return normalize(p.fornecedor)===qn; });
}
function desempenhoFornecedor(nomeFornecedor){
  var pedidos = pedidosDoFornecedor(nomeFornecedor);
  var recebimentosComData = [];
  var problemasQualidade = 0, totalRecebimentos = 0;
  pedidos.forEach(function(p){
    (p.recebimentos||[]).forEach(function(r){
      totalRecebimentos++;
      if(r.problemaQualidade) problemasQualidade++;
      if(p.dataPrevista) recebimentosComData.push({ noPrazo: r.data <= p.dataPrevista });
    });
  });
  var noPrazo = recebimentosComData.filter(function(r){ return r.noPrazo; }).length;
  return {
    nPedidos: pedidos.length,
    valorTotal: pedidos.reduce(function(a,p){ return a + (p.valorTotal||0); }, 0),
    otdPct: recebimentosComData.length ? (noPrazo/recebimentosComData.length*100) : null,
    qualidadePct: totalRecebimentos ? ((totalRecebimentos-problemasQualidade)/totalRecebimentos*100) : null,
    nRecebimentos: totalRecebimentos
  };
}
function migrateCotacao(cot){
  if(cot.itensCotados) return cot;
  return {
    id: cot.id, criadoEm: cot.criadoEm, obraId: cot.obraId||null, obs: cot.obs||'',
    itensCotados: [{
      itemCodigo: cot.itemCodigo, itemDescricao: cot.itemDescricao, quantidade: cot.quantidade,
      linhas: cot.itens || [], vencedor: cot.vencedor||null, status: cot.status||'aberta',
      aprovadoPor: cot.aprovadoPor, aprovadoEm: cot.aprovadoEm,
      economiaEstimada: cot.economiaEstimada, precoMedioReferencia: cot.precoMedioReferencia,
      justificativaExcecao: cot.justificativaExcecao
    }]
  };
}

/* ============================================================
   Toasts
   ============================================================ */
function toast(msg, isErr){
  var id = 't'+Date.now()+Math.random().toString(36).slice(2,6);
  UI.toasts.push({ id:id, msg:msg, err:!!isErr });
  renderToasts();
  setTimeout(function(){ UI.toasts = UI.toasts.filter(function(t){ return t.id!==id; }); renderToasts(); }, 4200);
}
function renderToasts(){
  var el = document.getElementById('toast-stack'); if(!el) return;
  el.innerHTML = UI.toasts.map(function(t){ return '<div class="toast'+(t.err?' err':'')+'">'+esc(t.msg)+'</div>'; }).join('');
}

/* ============================================================
   Persistence
   ============================================================ */
function buildFullDocument(){
  var dataObj = {
    kpis: STATE.kpis, fornecedores: STATE.fornecedores, produtos: STATE.produtos,
    tendenciaMensal: STATE.tendenciaMensal, gastoPorTipo: STATE.gastoPorTipo,
    fornecedoresMesclados: STATE.fornecedoresMesclados, reposicaoCandidatos: STATE.reposicaoCandidatos,
    periodoDias: STATE.periodoDias,
    avaliacoes: STATE.avaliacoes, cotacoes: STATE.cotacoes, contratos: STATE.contratos,
    configAprovacao: STATE.configAprovacao, configReposicao: STATE.configReposicao, pontosPedido: STATE.pontosPedido,
    obras: STATE.obras, estoqueAtual: STATE.estoqueAtual,
    atividades: STATE.atividades, branding: STATE.branding,
    itensPersonalizados: STATE.itensPersonalizados,
    pedidos: STATE.pedidos, pedidosSeq: STATE.pedidosSeq, fornecedoresSeq: STATE.fornecedoresSeq, segundaFonte: STATE.segundaFonte, empresa: STATE.empresa,
    usuarios: STATE.usuarios, configAuth: STATE.configAuth, notificacoes: STATE.notificacoes,
    agendamentos: STATE.agendamentos, horaExtra: STATE.horaExtra,
    comparativo: STATE.comparativo
  };
  var json = JSON.stringify(dataObj).replace(/</g, '\\u003c');
  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>Central de Compras</title>\n'
    + FONT_LINK_OUTER + '\n' + STYLE_OUTER + '\n'
    + '</head>\n<body>\n'
    + '<div class="app-root" id="app-root"><div id="app"></div><div class="toast-stack" id="toast-stack"></div></div>\n'
    + '<script id="data-blob" type="application/json">' + json + '<' + '/script>\n'
    + SELF_SCRIPT_OUTER + '\n</body>\n</html>';
}

/* Grava o estado. Sem serviço de gravação (arquivo aberto do disco), a alteração vale só
   enquanto a aba estiver aberta e o aviso diz isso com todas as letras — ninguém deve
   descobrir que perdeu trabalho só no dia seguinte. */
var gravando = false;
function persist(successMsg){
  if(gravando) return;
  gravando = true;
  var go = function(){
    if(!servicoGravacao){
      gravando = false; UI.syncState = 'local';
      toast(successMsg + ' (salvo só nesta sessão — esta cópia está aberta em modo local)');
      return;
    }
    servicoGravacao.publish(buildFullDocument()).then(function(){
      gravando = false;
    }).catch(function(err){
      gravando = false;
      var code = err && err.code;
      if(code==='conflict'){ /* outra gravação chegou antes; a tela já vai recarregar */ }
      else if(code==='not_writer' || code==='not_granted'){ UI.syncState = 'readonly'; toast('Este painel está em modo somente leitura para você agora.', true); render(); }
      else { toast('Não foi possível salvar agora. Tente de novo em instantes.', true); }
    });
  };
  if(!hostVerificado){ setTimeout(go, 300); } else { go(); }
}

/* ============================================================
   Exportar dados brutos (CSV para copiar/colar no Excel)
   ============================================================ */
function statusLabelPlain(status){
  return { homologado:'Homologado', avaliacao:'Em avaliação', bloqueado:'Bloqueado' }[status] || 'Não avaliado';
}
function csvEscape(v){
  var s = String(v==null?'':v);
  if(s.indexOf(';')>-1 || s.indexOf('"')>-1 || s.indexOf('\n')>-1){ s = '"'+s.replace(/"/g,'""')+'"'; }
  return s;
}
function csvRow(arr){ return arr.map(csvEscape).join(';'); }
function csvNum(v){ return (v==null?0:v).toString().replace('.',','); }

function buildCsvFornecedores(){
  var rows = [['Código','Nome','CNPJ','Razão social','Classe ABC','Gasto total (R$)','Nº pedidos','Nº itens fornecidos','Status de homologação','Condição de pagamento','Endereço','Cidade','UF']];
  STATE.fornecedores.slice().sort(function(a,b){return b.spend-a.spend;}).forEach(function(s){
    var av = getAvaliacao(s.codigo);
    rows.push([s.codigo, titleCase(s.nome), av.cnpj||'', av.razaoSocial||'', s.abc||'', csvNum(s.spend), s.nPedidos, s.nProdutos, statusLabelPlain(av.status), av.condicaoPagamento||'', av.endereco||'', titleCase(av.cidade||''), (av.uf||'').toUpperCase()]);
  });
  return rows.map(csvRow).join('\n');
}
function buildCsvItens(){
  var rows = [['Código','Descrição','Categoria','Quadrante','Gasto total (R$)','Preço médio (R$)','Nº pedidos','Nº fornecedores']];
  produtosAtivos().slice().sort(function(a,b){return b.spend-a.spend;}).forEach(function(p){
    rows.push([p.codigo||'', titleCase(p.descricao), tipoLabel(p.tipo), QUAD_LABELS[p.quadrante]||p.quadrante, csvNum(p.spend), csvNum(p.precoMedio), p.nPedidos, p.nFornecedores]);
  });
  return rows.map(csvRow).join('\n');
}
function buildCsvCotacoesFechadas(){
  var rows = [['Data de fechamento','Item','Quantidade','Unidade','Fornecedor vencedor','Preço unitário (R$)','Valor total (R$)','Status','Solicitante','Setor']];
  itensFechados().forEach(function(x){
    var linha = (x.item.linhas||[]).find(function(l){return l.fornecedor===x.item.vencedor;});
    rows.push([
      x.item.fechadoEm ? x.item.fechadoEm.slice(0,10) : x.cot.criadoEm.slice(0,10),
      titleCase(x.item.itemDescricao), csvNum(x.item.quantidade||0), x.item.unidade||'',
      titleCase(x.item.vencedor||''), csvNum(linha?parseFloat(linha.preco)||0:0), csvNum(itemValorFechado(x.item)),
      x.item.status==='aguardando_aprovacao'?'Aguardando aprovação':'Aprovada',
      x.cot.solicitante||'', x.cot.setor||''
    ]);
  });
  return rows.map(csvRow).join('\n');
}
function buildCsvPedidos(){
  var rows = [['Número','Item','Fornecedor','Quantidade','Unidade','Valor total (R$)','Data de emissão','Previsão de entrega','Status','Solicitante','Setor']];
  STATE.pedidos.forEach(function(p){
    rows.push([p.numero, titleCase(p.itemDescricao), titleCase(p.fornecedor), csvNum(p.quantidade), p.unidade||'', csvNum(p.valorTotal), p.dataEmissao.slice(0,10), p.dataPrevista||'', pedidoStatusLabel(pedidoStatus(p)), p.solicitante||'', p.setor||'']);
  });
  return rows.map(csvRow).join('\n');
}
var CSV_DATASETS = {
  fornecedores: { label:'Fornecedores', fn: buildCsvFornecedores },
  itens: { label:'Itens', fn: buildCsvItens },
  cotacoes: { label:'Cotações fechadas', fn: buildCsvCotacoesFechadas },
  pedidos: { label:'Pedidos de compra', fn: buildCsvPedidos },
  comparativo: { label:'Mapa comparativo', fn: function(){ return buildCsvComparativo(); } }
};
function renderCsvExportModal(){
  if(!UI.csvExport.showModal) return '';
  var ds = CSV_DATASETS[UI.csvExport.dataset] || CSV_DATASETS.fornecedores;
  var csvText = ds.fn();
  var chips = Object.keys(CSV_DATASETS).map(function(k){
    return '<button class="chip'+(UI.csvExport.dataset===k?' active':'')+'" data-csv-dataset="'+k+'">'+CSV_DATASETS[k].label+'</button>';
  }).join('');
  return ''
    + '<div class="modal-backdrop" id="csv-export-backdrop">'
    + '  <div class="modal" style="max-width:640px">'
    + '    <div class="modal-head"><h2 style="font-size:17px">Exportar dados brutos</h2><button class="modal-close" data-close-csv-export>'+icon('close')+'</button></div>'
    + '    <div class="modal-body">'
    + '      <div class="chip-row" style="margin-bottom:10px">'+chips+'</div>'
    + '      <div class="footnote" style="margin-bottom:8px">Selecione o texto abaixo (ou use o botão) e cole direto numa planilha do Excel/Google Sheets — colunas separadas por ponto e vírgula.</div>'
    + '      <textarea id="csv-export-textarea" readonly style="width:100%;height:280px;font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;padding:10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink)">'+esc(csvText)+'</textarea>'
    + '      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">'
    + '        <button class="btn secondary" data-close-csv-export>Fechar</button>'
    + '        <button class="btn" id="btn-selecionar-csv">Selecionar tudo</button>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   Layout shell + nav
   ============================================================ */
var NAV_ITEMS = [
  { id:'visao-geral', label:'Visão geral', icon:'dashboard' },
  { id:'fornecedores', label:'Fornecedores', icon:'factory', badge: function(){ return STATE.fornecedores.length; } },
  { id:'itens', label:'Itens & Matriz', icon:'cube', badge: function(){ return produtosAtivos().length; } },
  { id:'cotacoes', label:'Cotações', icon:'scale', badge: function(){ return STATE.cotacoes.filter(function(c){return cotacaoStatusGeral(c)!=='aprovada';}).length; } },
  { id:'comparativo', label:'Mapa comparativo', icon:'compare', badge: function(){ var n = Object.keys(STATE.comparativo.selecionados).length; return n>0 ? n : null; } },
  { id:'pedidos', label:'Pedidos de compra', icon:'package', badge: function(){ return pedidosAtrasados().length; } },
  { id:'agendamento', label:'Agendamento de Compras', icon:'kanban', badge: function(){ return STATE.agendamentos.filter(function(a){return a.status!=='comprado';}).length; } },
  { id:'compras-periodo', label:'Compras por período', icon:'chart' },
  { id:'reposicao', label:'Reposição', icon:'refresh', badge: function(){ return STATE.reposicaoCandidatos.length; } },
  { id:'contratos', label:'Contratos', icon:'contract', badge: function(){ return STATE.contratos.filter(function(c){return c.status!=='encerrado';}).length; } },
  { id:'obras', label:'Obras', icon:'briefcase', badge: function(){ return STATE.obras.filter(function(o){return o.status==='ativa';}).length; } },
  { id:'alertas', label:'Alertas', icon:'alert', badge: function(){ return priceVariationOpportunities().length + topStrategicSingleSource().length + contratosAtencao().length + cotacoesPendentesAprovacao().length + dueDiligencePendente().length; } },
  { id:'atividades', label:'Atividades', icon:'clock' },
  { id:'hora-extra', label:'Hora Extra', icon:'food', badge: function(){ return STATE.horaExtra.filter(function(h){return h.status==='pendente';}).length; } },
  { id:'usuarios', label:'Usuários', icon:'shield', adminOnly:true, badge: function(){ var p = STATE.usuarios.filter(function(u){ return usuarioStatus(u)==='pendente'; }).length; return p>0 ? p : null; } }
];

var visaoGeralSub = STATE.tendenciaMensal.length
  ? 'Panorama de compras — ' + monthLabel(STATE.tendenciaMensal[0].mes) + ' a ' + monthLabel(STATE.tendenciaMensal[STATE.tendenciaMensal.length-1].mes)
  : 'Panorama de compras';
var TAB_TITLES = {
  'visao-geral': ['Visão geral', visaoGeralSub],
  'fornecedores': ['Fornecedores', num(STATE.fornecedores.length) + ' fornecedores (cadastros duplicados já consolidados)'],
  'itens': ['Itens & matriz de criticidade', ''],
  'cotacoes': ['Cotações', 'Registre no mínimo 3 orçamentos com foto por item — o administrador escolhe qual aceitar'],
  'comparativo': ['Mapa comparativo', 'Compare propostas de fornecedores lado a lado — preço, prazo, pagamento e condições — e registre a escolha com justificativa'],
  'pedidos': ['Pedidos de compra', 'Emitidos automaticamente quando uma cotação é aprovada — registre o recebimento da mercadoria aqui'],
  'agendamento': ['Agendamento de Compras', 'Atribua compras a um operador ir buscar e acompanhe o andamento em quadro Kanban'],
  'compras-periodo': ['Compras por período', 'Compras fechadas agrupadas por semana e por mês, com os itens e fornecedores que mais compramos'],
  'reposicao': ['Reposição', 'Sugestão de ponto de pedido a partir do consumo histórico'],
  'contratos': ['Contratos indexados', 'Contratos de fornecimento com reajuste por índice'],
  'obras': ['Obras & centros de custo', 'Vincule cotações e contratos a uma obra para acompanhar o gasto por projeto'],
  'alertas': ['Alertas & oportunidades', 'Pontos que merecem atenção do comprador'],
  'atividades': ['Atividades recentes', 'Registro de quem fez cada alteração no painel'],
  'hora-extra': ['Hora Extra', 'Pedidos de lanche e marmita para a equipe em hora extra, por setor'],
  'usuarios': ['Usuários', 'Contas de acesso ao painel — administrador, operador ou chefe de setor']
};
function getTabTitle(tab){
  var t = TAB_TITLES[tab] || ['',''];
  if(tab==='itens'){ return [t[0], num(produtosAtivos().length) + ' itens classificados por gasto e risco de fornecimento (reconstruído a partir das compras fechadas)']; }
  return t;
}

/* ============================================================
   Autenticação: tela de login / cadastro
   ============================================================ */
function renderAuthScreen(){
  var a = UI.auth;
  var logoHtml = STATE.branding.logoDataUrl
    ? '<img src="'+STATE.branding.logoDataUrl+'" alt="Logo" width="40" height="40" style="display:block;width:40px;height:40px;object-fit:contain">'
    : icon('factory');

  var tabsHtml = a.screen==='enviado' ? '' : ('<div class="auth-tabs">'
    + '<button class="auth-tab'+(a.screen==='login'?' active':'')+'" data-auth-tab="login">Entrar</button>'
    + '<button class="auth-tab'+(a.screen==='cadastro'?' active':'')+'" data-auth-tab="cadastro">Cadastrar</button>'
    + '</div>');

  var bodyHtml;
  if(a.screen==='enviado'){
    bodyHtml = '<div class="qform" style="text-align:center">'
      + '  <div style="width:52px;height:52px;margin:2px auto 14px;border-radius:50%;background:var(--good-soft);color:var(--good-ink);display:flex;align-items:center;justify-content:center">'+icon('check')+'</div>'
      + '  <div style="font-weight:700;font-size:15.5px;color:var(--ink)">Cadastro enviado</div>'
      + '  <div class="footnote" style="margin-top:8px">Seu cadastro foi recebido e está aguardando a aprovação de um administrador. Assim que ele revisar sua solicitação, você poderá entrar normalmente com o e-mail e a senha que acabou de cadastrar.</div>'
      + '  <button class="btn" id="btn-cadastro-voltar-login" style="width:100%;justify-content:center;margin-top:18px">Voltar para o login</button>'
      + '</div>';
  } else if(a.screen==='cadastro'){
    bodyHtml = '<div class="qform">'
      + '  <div class="field"><label>Nome completo</label><input type="text" id="input-cad-nome" placeholder="Seu nome completo" value="'+esc(a.cadNome)+'"></div>'
      + '  <div class="field" style="display:grid;grid-template-columns:2fr 1fr;gap:10px">'
      + '    <div><label>E-mail</label><input type="text" inputmode="email" id="input-cad-email" placeholder="voce@empresa.com" value="'+esc(a.cadEmail)+'"></div>'
      + '    <div><label>Ramal</label><input type="text" id="input-cad-ramal" placeholder="Ex.: 1234" value="'+esc(a.cadRamal)+'"></div>'
      + '  </div>'
      + '  <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '    <div><label>Senha</label><input type="password" id="input-cad-senha" placeholder="Mínimo 6 caracteres"></div>'
      + '    <div><label>Confirmar senha</label><input type="password" id="input-cad-senha2" placeholder="Repita a senha"></div>'
      + '  </div>'
      + '  <div class="field"><label>Tipo de conta</label><div class="chip-row" id="chip-row-cad-tipo">'
      + '    <button type="button" class="chip'+(a.cadTipo!=='chefe_setor'?' active':'')+'" data-cad-tipo="operador">Operador</button>'
      + '    <button type="button" class="chip'+(a.cadTipo==='chefe_setor'?' active':'')+'" data-cad-tipo="chefe_setor">Chefe de Setor</button>'
      + '  </div>'
      + '  <div class="footnote" style="margin-top:4px">Operador acessa todo o painel (exceto Usuários). Chefe de Setor só acessa a aba Hora Extra, para pedir lanche/marmita da equipe.</div>'
      + '  </div>'
      + '  <div class="field"><label>Código de administrador (opcional)</label><input type="text" id="input-cad-codigo" placeholder="Deixe em branco para se cadastrar como operador" value="'+esc(a.cadCodigo)+'"></div>'
      + (a.cadErro ? '<div class="footnote" style="color:var(--critical-ink)">'+esc(a.cadErro)+'</div>' : '')
      + '  <button class="btn" id="btn-cadastro-submit" style="width:100%;justify-content:center;margin-top:6px"'+(a.busy?' disabled':'')+'>'+(a.busy?'Enviando...':'Cadastrar')+'</button>'
      + '</div>';
  } else {
    bodyHtml = '<div class="qform">'
      + '  <div class="field"><label>E-mail</label><input type="text" inputmode="email" id="input-login-email" placeholder="voce@empresa.com" value="'+esc(a.loginEmail)+'"></div>'
      + '  <div class="field"><label>Senha</label><input type="password" id="input-login-senha" placeholder="Sua senha"></div>'
      + (a.loginErro ? '<div class="footnote" style="color:var(--critical-ink)">'+esc(a.loginErro)+'</div>' : '')
      + '  <button class="btn" id="btn-login-submit" style="width:100%;justify-content:center;margin-top:6px"'+(a.busy?' disabled':'')+'>'+(a.busy?'Entrando...':'Entrar')+'</button>'
      + '</div>';
  }

  return '<div class="auth-wrap">'
    + '  <div class="auth-card">'
    + '    <div class="auth-brand"><div class="brand-mark">'+logoHtml+'</div><div class="brand-text"><strong>Central de Compras</strong><span>Suprimentos</span></div></div>'
    + tabsHtml
    + bodyHtml
    + '    <div class="footnote" style="margin-top:16px;text-align:center">'+(empresaNome() ? 'Suprimentos · '+esc(empresaNome())+' — acesso restrito à equipe.' : 'Acesso restrito à equipe.')+'</div>'
    + '  </div>'
    + '</div>';
}

function renderShell(){
  var navHtml = NAV_ITEMS.filter(function(item){
    if(isChefeSetor()) return item.id==='hora-extra';
    return !item.adminOnly || isAdmin();
  }).map(function(item){
    var badgeVal = item.badge ? item.badge() : null;
    return '<button class="nav-item'+(UI.tab===item.id?' active':'')+'" data-nav="'+item.id+'">'
      + icon(item.icon) + '<span>'+item.label+'</span>'
      + (badgeVal ? '<span class="nav-badge">'+num(badgeVal)+'</span>' : '')
      + '</button>';
  }).join('');

  var syncHtml;
  if(UI.syncState==='readonly'){ syncHtml = '<div class="sync-pill"><span class="sync-dot warn"></span>Somente leitura</div>'; }
  else if(servicoGravacao){ syncHtml = '<div class="sync-pill"><span class="sync-dot"></span>Alterações salvas para a equipe</div>'; }
  else { syncHtml = '<div class="sync-pill"><span class="sync-dot off"></span>Modo local (não salva)</div>'; }

  var title = getTabTitle(UI.tab);

  var logoHtml = STATE.branding.logoDataUrl
    ? '<img src="'+STATE.branding.logoDataUrl+'" alt="Logo" width="34" height="34" style="display:block;width:34px;height:34px;object-fit:contain">'
    : icon('factory');

  var usuarioLogado = currentUsuario();
  var identityHtml = usuarioLogado
    ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">'
      + '<div class="sidebar-user">'+icon('user')+'<span>'+esc(usuarioLogado.nomeCompleto)+'</span></div>'
      + '<div class="sidebar-user-papel">'+papelLabel(usuarioLogado.papel)+(usuarioLogado.ramal?' · ramal '+esc(usuarioLogado.ramal):'')+'</div>'
      + '<button class="btn ghost small" id="btn-logout" style="width:100%;justify-content:center">Sair</button>'
      + '</div>'
    : '';

  return ''
    + '<div class="shell">'
    + '  <aside class="sidebar">'
    + '    <div class="brand"><div class="brand-mark">' + logoHtml + '</div>'
    + '      <div class="brand-text"><strong>Central de Compras</strong><span>Suprimentos</span></div></div>'
    + '    <div class="nav-group-label">Painel</div>'
    + '    <nav class="nav-list">' + navHtml + '</nav>'
    + '    <div class="sidebar-foot">Dados de pedidos de compra vinculados a fornecedores.' + syncHtml + identityHtml + '</div>'
    + '  </aside>'
    + '  <div class="main">'
    + '    <div class="topbar"><div><h1>'+title[0]+'</h1><div class="sub">'+title[1]+'</div></div>'
    + '      <div class="no-print" style="display:flex;gap:8px;align-items:center">'
    + '        <div class="notif-wrap">'
    + '          <button class="btn secondary small notif-bell-btn" id="btn-toggle-notificacoes" title="Notificações">'+icon('bell')
    + (notificacoesNaoLidasCount()>0 ? '<span class="notif-badge">'+notificacoesNaoLidasCount()+'</span>' : '')
    + '</button>'
    + (UI.notifOpen ? renderNotificacoesPainel() : '')
    + '        </div>'
    + '        <label class="btn secondary small" style="cursor:pointer">'+icon('image')+' Logo<input type="file" id="input-logo-upload" accept="image/*" style="display:none"></label>'
    + '        <button class="btn secondary small" id="btn-abrir-csv-export">'+icon('download')+' Exportar dados (CSV)</button>'
    + '        <button class="btn secondary small" id="btn-exportar-relatorio">'+icon('download')+' Exportar relatório</button>'
    + '      </div>'
    + '    </div>'
    + '    <div class="content" id="tab-content">' + renderTab() + '</div>'
    + '  </div>'
    + '</div>'
    + renderPrintReport()
    + renderCsvExportModal();
}

function renderNotificacoesPainel(){
  var lista = notificacoesDoUsuario();
  var head = '<div class="notif-panel-head"><strong>Notificações</strong>'
    + (notificacoesNaoLidasCount()>0 ? '<button class="link-btn" id="btn-marcar-todas-lidas">Marcar todas como lidas</button>' : '')
    + '<button class="icon-btn" id="btn-fechar-notificacoes">'+icon('close')+'</button></div>';
  if(!lista.length){
    return '<div class="notif-panel">'+head+'<div class="empty-state" style="padding:22px 14px">'+icon('bell')+'<div>Nenhuma notificação por aqui ainda.</div></div></div>';
  }
  var itensHtml = lista.slice(0,50).map(function(n){
    var cot = STATE.cotacoes.find(function(c){ return c.id===n.cotacaoId; });
    var item = cot ? (cot.itensCotados||[])[n.itemIdx] : null;
    var quando = dateBR(n.criadoEm.slice(0,10)) + ' às ' + n.criadoEm.slice(11,16);
    var iconCls, iconName, corpo;
    if(n.tipo==='aprovada'){
      iconCls = 'good'; iconName = 'check';
      corpo = '<div class="notif-title">Cotação aprovada</div>'
        + '<div class="notif-body">'+esc(titleCase(n.itemDescricao))+' foi aceita'+(item && item.aprovadoPor ? ' por '+esc(item.aprovadoPor) : '')+'.</div>'
        + (item ? '<div class="notif-status-row">' + ['pendente','em_andamento','realizada'].map(function(st){
              return '<button class="chip'+(item.acompanhamento===st?' active':'')+'" data-set-acompanhamento="'+st+'" data-cotacao-id="'+cot.id+'" data-item-idx="'+n.itemIdx+'" data-notif-id="'+n.id+'">'+ACOMPANHAMENTO_LABEL[st]+'</button>';
            }).join('') + '</div>' : '');
    } else if(n.tipo==='recusada'){
      iconCls = 'crit'; iconName = 'close';
      corpo = '<div class="notif-title">Operação recusada</div>'
        + '<div class="notif-body">Operação recusada na cotação — '+esc(titleCase(n.itemDescricao))+'.</div>';
    } else {
      iconCls = 'warn'; iconName = 'clock';
      corpo = '<div class="notif-title">Lembrete</div>'
        + '<div class="notif-body">'+esc(titleCase(n.itemDescricao))+' está aprovada e ainda não foi marcada como Realizada.</div>';
    }
    return '<div class="notif-item'+(n.lida?'':' unread')+'">'
      + '<div class="notif-icon '+iconCls+'">'+icon(iconName)+'</div>'
      + '<div class="notif-content">' + corpo
      + '<div class="notif-meta"><span>'+quando+'</span>'
      + (cot ? '<button class="link-btn" data-ver-cotacao-notif="'+n.id+'" data-cotacao-id="'+cot.id+'">Ver cotação</button>' : '')
      + (n.lida ? '' : '<button class="link-btn" data-marcar-lida="'+n.id+'">Marcar como lida</button>')
      + '</div></div></div>';
  }).join('');
  return '<div class="notif-panel">'+head+'<div class="notif-list">'+itensHtml+'</div></div>';
}

function renderPrintReport(){
  var k = STATE.kpis;
  var logoHtml = STATE.branding.logoDataUrl ? '<img class="pr-logo" src="'+STATE.branding.logoDataUrl+'" alt="Logo" width="48" height="48">' : '';
  var top10 = STATE.fornecedores.slice(0,10);
  var topHtml = top10.map(function(s){ return '<tr><td>'+esc(titleCase(s.nome))+'</td><td>'+abcBadgeText(s.abc)+'</td><td>'+money(s.spend)+'</td><td>'+fmtPct(s.pct,1)+'</td></tr>'; }).join('');

  var strategic = topStrategicSingleSource().slice(0,10);
  var strategicHtml = strategic.map(function(p){ return '<tr><td>'+esc(titleCase(p.descricao))+'</td><td>'+money(p.spend)+'</td><td>'+(p.fornecedores[0]?esc(titleCase(p.fornecedores[0].nome)):'—')+'</td></tr>'; }).join('');

  var contratosAtt = contratosAtencao();
  var contratosHtml = contratosAtt.map(function(x){ return '<tr><td>'+esc(titleCase(x.c.fornecedorNome))+'</td><td>'+esc(x.c.escopo)+'</td><td>'+dateBR(x.c.proximoReajuste)+'</td></tr>'; }).join('') || '<tr><td colspan="3">Nenhum contrato com reajuste próximo.</td></tr>';

  var pendAprov = itensPendentesAprovacao();
  var aprovacaoHtml = pendAprov.map(function(x){ return '<tr><td>'+esc(itemLabel(x.item))+'</td><td>'+dateBR(x.cot.criadoEm.slice(0,10))+'</td></tr>'; }).join('') || '<tr><td colspan="2">Nenhuma cotação pendente.</td></tr>';

  var econTotal = economiaTotal();

  return ''
    + '<div id="print-report">'
    + '  <div class="pr-header">'+logoHtml+'<div><h1>Central de Compras — Relatório de Suprimentos</h1><div class="pr-sub">Gerado em '+dateBR(todayISO())+' · período dos dados: '+dateBR(k.periodoInicio)+' a '+dateBR(k.periodoFim)+'</div></div></div>'
    + '  <div class="pr-kpis">'
    + '    <div class="pr-kpi"><div class="l">Gasto no período</div><div class="v">'+money(k.totalSpend)+'</div></div>'
    + '    <div class="pr-kpi"><div class="l">Pedidos</div><div class="v">'+num(k.nPedidos)+'</div></div>'
    + '    <div class="pr-kpi"><div class="l">Fornecedores ativos</div><div class="v">'+num(k.nFornecedores)+'</div></div>'
    + '    <div class="pr-kpi"><div class="l">Itens fornecedor único</div><div class="v">'+k.pctItensSingleSource+'%</div></div>'
    + '    <div class="pr-kpi"><div class="l">Economia em cotações</div><div class="v">'+money(econTotal)+'</div></div>'
    + '  </div>'
    + '  <div class="pr-section"><h2>Top 10 fornecedores por gasto</h2><table><thead><tr><th>Fornecedor</th><th>Classe</th><th>Gasto</th><th>% total</th></tr></thead><tbody>'+topHtml+'</tbody></table></div>'
    + '  <div class="pr-section"><h2>Itens estratégicos com fornecedor único</h2><table><thead><tr><th>Item</th><th>Gasto</th><th>Fornecedor</th></tr></thead><tbody>'+strategicHtml+'</tbody></table></div>'
    + '  <div class="pr-section"><h2>Contratos com reajuste próximo (30 dias)</h2><table><thead><tr><th>Fornecedor</th><th>Escopo</th><th>Próximo reajuste</th></tr></thead><tbody>'+contratosHtml+'</tbody></table></div>'
    + '  <div class="pr-section"><h2>Cotações aguardando aprovação</h2><table><thead><tr><th>Item</th><th>Registrada em</th></tr></thead><tbody>'+aprovacaoHtml+'</tbody></table></div>'
    + '  <div class="pr-foot">Relatório gerado automaticamente pela Central de Compras. Os indicadores de gasto e matriz de criticidade refletem os dados importados do ERP; cotações, contratos e obras refletem o uso do painel até a data acima.</div>'
    + '</div>';
}
function abcBadgeText(abc){ return abc ? 'Classe '+abc : 'Sem classificação'; }

function renderTab(){
  /* Chefe de setor só pode ver a aba Hora Extra — nunca deixe UI.tab velho/errado
     escapar disso, mesmo que tenha sido definido antes de o usuário logado mudar. */
  if(isChefeSetor()){ UI.tab = 'hora-extra'; return renderHoraExtra(); }
  if(UI.tab==='visao-geral') return renderVisaoGeral();
  if(UI.tab==='fornecedores') return renderFornecedores();
  if(UI.tab==='itens') return renderItens();
  if(UI.tab==='cotacoes') return renderCotacoes();
  if(UI.tab==='comparativo') return renderComparativo();
  if(UI.tab==='pedidos') return renderPedidos();
  if(UI.tab==='agendamento') return renderAgendamento();
  if(UI.tab==='compras-periodo') return renderComprasPeriodo();
  if(UI.tab==='reposicao') return renderReposicao();
  if(UI.tab==='contratos') return renderContratos();
  if(UI.tab==='obras') return renderObras();
  if(UI.tab==='alertas') return renderAlertas();
  if(UI.tab==='atividades') return renderAtividades();
  if(UI.tab==='hora-extra') return renderHoraExtra();
  if(UI.tab==='usuarios'){
    if(!isAdmin()){ UI.tab = 'visao-geral'; return renderVisaoGeral(); }
    return renderUsuarios();
  }
  return '';
}

/* ============================================================
   TAB: Visão geral
   ============================================================ */
function renderVisaoGeral(){
  var k = STATE.kpis;
  var maxMonth = STATE.tendenciaMensal.length ? Math.max.apply(null, STATE.tendenciaMensal.map(function(m){return m.spend;})) : 0;
  var trendHtml = STATE.tendenciaMensal.map(function(m){
    var pct = maxMonth>0 ? (m.spend/maxMonth*100).toFixed(1) : '0';
    return '<div class="bar-row"><div class="label">'+monthLabel(m.mes)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:var(--cat-1)"></div></div><div class="bar-val">'+money(m.spend)+'</div></div>';
  }).join('') || '<div class="footnote">Sem histórico de gasto mensal ainda.</div>';

  var totalTipo = STATE.gastoPorTipo.reduce(function(a,b){return a+b.spend;},0);
  var tipoColors = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)'];
  var top5 = STATE.gastoPorTipo.slice(0,5);
  var outros = STATE.gastoPorTipo.slice(5).reduce(function(a,b){return a+b.spend;},0);
  var tipoHtml = top5.map(function(t,i){
    var pct = totalTipo>0 ? (t.spend/totalTipo*100).toFixed(1) : '0';
    return '<div class="bar-row"><div class="label">'+tipoLabel(t.tipo)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+tipoColors[i]+'"></div></div><div class="bar-val">'+pct+'%</div></div>';
  }).join('') + (outros>0 && totalTipo>0 ? '<div class="bar-row"><div class="label">Outros</div><div class="bar-track"><div class="bar-fill" style="width:'+(outros/totalTipo*100).toFixed(1)+'%;background:var(--cat-other)"></div></div><div class="bar-val">'+(outros/totalTipo*100).toFixed(1)+'%</div></div>' : '');
  if(!top5.length) tipoHtml = '<div class="footnote">Sem histórico de gasto por categoria ainda.</div>';

  var top10 = STATE.fornecedores.slice(0,10);
  var maxSup = top10.length ? top10[0].spend : 0;
  var topSupHtml = top10.map(function(s){
    var pct = maxSup>0 ? (s.spend/maxSup*100).toFixed(1) : '0';
    return '<div class="bar-row"><div class="label" title="'+esc(s.nome)+'">'+esc(titleCase(s.nome))+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:var(--steel)"></div></div><div class="bar-val">'+money(s.spend)+'</div></div>';
  }).join('') || '<div class="footnote">Sem histórico de gasto por fornecedor ainda.</div>';

  var totalEstrategico = produtosAtivos().filter(function(p){return p.quadrante==='estrategico';}).length;
  var pendAprov = cotacoesPendentesAprovacao().length;
  var contratosAtt = contratosAtencao().length;
  var econTotal = economiaTotal();
  var econCount = economiaPositivaCount();
  var dueDilig = dueDiligencePendente().length;

  return ''
    + '<div class="kpi-grid">'
    + kpiTile('Gasto no período', money(k.totalSpend), dateBR(k.periodoInicio)+' – '+dateBR(k.periodoFim))
    + kpiTile('Pedidos de compra', num(k.nPedidos), num(k.nProdutos)+' itens distintos')
    + kpiTile('Fornecedores ativos', num(k.nFornecedores), num(k.nFornecedores80pct)+' concentram 80% do gasto')
    + kpiTile('Itens só com 1 fornecedor', k.pctItensSingleSource.toString().replace('.',',')+'%', num(k.nItensSingleSource)+' de '+num(k.nProdutos)+' itens — risco de fornecimento', true)
    + kpiTile('Economia em cotações', money(econTotal), econCount+' cotação(ões) fechada(s) abaixo do preço médio histórico', econTotal<0)
    + '</div>'
    + (STATE.fornecedoresMesclados.length ? '<div class="alert-card" style="margin-top:14px"><div class="alert-icon info">'+icon('check')+'</div><div><div class="alert-title">Cadastro de fornecedores consolidado</div><div class="alert-body">'+num(STATE.fornecedoresMesclados.length)+' fornecedores que tinham mais de um código no ERP (ex.: '+esc(titleCase(STATE.fornecedoresMesclados[0].nome))+') foram unificados em um único registro nesta versão do painel — o histórico de gasto e avaliação agora fica inteiro num só lugar. Veja o detalhe na aba <strong>Fornecedores</strong>.</div></div></div>' : '')
    + '<div class="grid-2" style="margin-top:16px">'
    + '  <div class="card"><div class="card-head"><h2>Gasto por mês</h2><span class="hint">período coberto pelo histórico</span></div>'+trendHtml+'</div>'
    + '  <div class="card"><div class="card-head"><h2>Gasto por categoria</h2><span class="hint">classificação do ERP</span></div>'+tipoHtml+'</div>'
    + '</div>'
    + '<div class="grid-2" style="margin-top:16px">'
    + '  <div class="card"><div class="card-head"><h2>Top 10 fornecedores</h2><span class="hint">por valor comprado, já consolidado</span></div>'+topSupHtml+'</div>'
    + '  <div class="card">'
    + '    <div class="card-head"><h2>Pontos de atenção</h2></div>'
    + '    <div class="alert-card" style="margin-bottom:10px"><div class="alert-icon crit">'+icon('alert')+'</div><div><div class="alert-title">'+num(totalEstrategico)+' itens estratégicos com fornecedor único</div><div class="alert-body">Alto gasto e sem alternativa cadastrada — veja a aba Alertas para a lista priorizada.</div></div></div>'
    + (pendAprov ? '<div class="alert-card" style="margin-bottom:10px"><div class="alert-icon warn">'+icon('scale')+'</div><div><div class="alert-title">'+num(pendAprov)+' cotação(ões) aguardando decisão do administrador</div><div class="alert-body">Escolha um dos orçamentos recebidos ou recuse a cotação — veja a aba Cotações.</div></div></div>' : '')
    + (contratosAtt ? '<div class="alert-card"><div class="alert-icon warn">'+icon('contract')+'</div><div><div class="alert-title">'+num(contratosAtt)+' contrato(s) com reajuste em até 30 dias</div><div class="alert-body">Veja a aba Contratos para revisar o índice e negociar antes do vencimento.</div></div></div>' : '')
    + (dueDilig ? '<div class="alert-card"><div class="alert-icon warn">'+icon('shield')+'</div><div><div class="alert-title">'+num(dueDilig)+' fornecedor(es) estratégico(s) sem due diligence completa</div><div class="alert-body">Situação fiscal ou certificações pendentes de verificação — veja a aba Alertas.</div></div></div>' : '')
    + '    <div class="footnote">Ver detalhes completos na aba <strong>Alertas</strong>.</div>'
    + '  </div>'
    + '</div>';
}

function kpiTile(label, value, note, flag){
  return '<div class="kpi-tile'+(flag?' flag':'')+'"><div class="kpi-label">'+label+'</div><div class="kpi-value">'+value+'</div><div class="kpi-note">'+note+'</div></div>';
}

/* ============================================================
   TAB: Fornecedores
   ============================================================ */
function renderFornecedores(){
  var f = UI.fornecedores;
  var list = filteredFornecedores();
  var visible = list.slice(0, f.limit);

  function th(key, label, numeric){
    var arrow = f.sortKey===key ? (f.sortDir==='asc'?'▲':'▼') : '';
    return '<th class="sortable'+(numeric?' num':'')+'" data-sort-fornecedor="'+key+'">'+label+' <span class="sort-arrow">'+arrow+'</span></th>';
  }

  var rows = visible.map(function(s){
    var av = getAvaliacao(s.codigo);
    var mesclado = s.codigosMesclados && s.codigosMesclados.length>1;
    return '<tr>'
      + '<td><div class="cell-primary">'+esc(titleCase(s.nome))+(mesclado?' <span class="badge badge-accent" title="Códigos '+esc(s.codigosMesclados.join(', '))+' consolidados em um único cadastro">'+s.codigosMesclados.length+' códigos unificados</span>':'')+'</div><div class="cell-sub">Código '+esc(s.codigo)+' · '+tipoLabel(s.tipoPrincipal)+'</div></td>'
      + '<td class="num">'+num(s.nPedidos)+'</td>'
      + '<td class="num">'+num(s.nProdutos)+'</td>'
      + '<td class="num">'+money(s.spend)+'</td>'
      + '<td class="num">'+fmtPct(s.pct,1)+'</td>'
      + '<td>'+abcBadge(s.abc)+'</td>'
      + '<td>'+statusBadge(av.status)+'</td>'
      + '<td><button class="btn ghost small" data-open-fornecedor="'+esc(s.codigo)+'">Avaliar</button></td>'
      + '</tr>';
  }).join('');

  var chips = ['todos','A','B','C'].map(function(a){
    var label = a==='todos' ? 'Todos' : 'Classe '+a;
    return '<button class="chip'+(f.abc===a?' active':'')+'" data-fornecedor-abc="'+a+'">'+label+'</button>';
  }).join('');

  var modal = UI.editingFornecedor ? renderFornecedorModal(UI.editingFornecedor) : '';
  var novoModal = renderNovoFornecedorModal();

  var mescladosCard = STATE.fornecedoresMesclados.length ? (''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Cadastros consolidados</h2><span class="hint">'+STATE.fornecedoresMesclados.length+' fornecedores que estavam duplicados no ERP</span></div>'
    + STATE.fornecedoresMesclados.map(function(m){
        return '<div class="bar-row"><div class="label" title="'+esc(m.nome)+'">'+esc(titleCase(m.nome))+'</div><div class="bar-val" style="width:auto;flex:1;text-align:left">códigos '+esc(m.codigos.join(', '))+' → '+money(m.spend)+' combinados</div></div>';
      }).join('')
    + '  <div class="footnote">Esses fornecedores apareciam sob mais de um código no ERP (normalmente uma filial/planta diferente com o mesmo CNPJ-raiz ou uma duplicidade de cadastro). O histórico de pedidos foi unificado por nome para que gasto, avaliação e negociação fiquem completos num só lugar — vale também corrigir isso na origem, no ERP.</div>'
    + '</div>') : '';

  return ''
    + '<div class="card">'
    + '  <div class="toolbar">'
    + '    <div class="search-wrap"><span class="search-icon">'+icon('search')+'</span><input type="text" class="search-input" id="input-fornecedor-search" placeholder="Buscar por nome ou código..." value="'+esc(f.search)+'"></div>'
    + '    <div class="chip-row">'+chips+'</div>'
    + '    <button class="btn" id="btn-abrir-novo-fornecedor">'+icon('plus')+' Novo fornecedor</button>'
    + '  </div>'
    + '  <div class="table-wrap table-scroll"><table class="data"><thead><tr>'
    + '<th>Fornecedor</th>'+th('nPedidos','Pedidos',1)+th('nProdutos','Itens',1)+th('spend','Gasto',1)+th('pct','% total',1)+'<th>Classe</th><th>Status</th><th></th>'
    + '</tr></thead><tbody>'+(rows||'<tr><td colspan="8"><div class="empty-state">'+icon('search')+'<div>Nenhum fornecedor encontrado.</div></div></td></tr>')+'</tbody></table></div>'
    + (list.length>visible.length ? '<div style="text-align:center;margin-top:12px"><button class="btn secondary small" id="btn-fornecedores-mais">Mostrar mais ('+ (list.length-visible.length) +' restantes)</button></div>' : '')
    + '  <div class="footnote">Classe A/B/C = concentração de gasto (curva ABC): A = fornecedores que somados chegam a 80% do gasto total, B até 95%, C o restante.</div>'
    + '</div>'
    + mescladosCard
    + modal
    + novoModal;
}

function renderFornecedorModal(codigo){
  var s = STATE.fornecedores.find(function(x){ return x.codigo===codigo; });
  if(!s) return '';
  var av = getAvaliacao(codigo);
  var itensDoFornecedor = produtosAtivos().filter(function(p){ return p.fornecedores.some(function(fn){ return fn.nome===s.nome; }); })
    .sort(function(a,b){return b.spend-a.spend;}).slice(0,6);
  var itensHtml = itensDoFornecedor.map(function(p){
    return '<div class="bar-row"><div class="label" title="'+esc(p.descricao)+'">'+esc(titleCase(p.descricao))+'</div><div class="bar-val" style="width:auto;text-align:right;flex:1">'+money(p.spend)+'</div></div>';
  }).join('') || '<div class="footnote">Sem itens associados.</div>';

  var stars = '';
  for(var i=1;i<=5;i++){ stars += '<button class="'+(i<=av.nota?'filled':'')+'" data-star="'+i+'" data-star-fornecedor="'+esc(codigo)+'">'+icon('star')+'</button>'; }

  var codigosNote = (s.codigosMesclados && s.codigosMesclados.length>1) ? '<div class="footnote">Cadastro unificado dos códigos: '+esc(s.codigosMesclados.join(', '))+'.</div>' : '';

  var desemp = desempenhoFornecedor(s.nome);
  var desempHtml = desemp.nPedidos ? (''
    + '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'
    + kpiTile('Entrega no prazo (OTD)', desemp.otdPct!=null ? fmtPct(desemp.otdPct,0) : '—', desemp.otdPct!=null ? 'com base nos recebimentos registrados' : 'sem recebimentos com prazo previsto ainda')
    + kpiTile('Qualidade dos recebimentos', desemp.qualidadePct!=null ? fmtPct(desemp.qualidadePct,0) : '—', desemp.nRecebimentos+' recebimento(s) sem problema relatado', desemp.qualidadePct!=null && desemp.qualidadePct<90)
    + kpiTile('Pedidos de compra', num(desemp.nPedidos), money(desemp.valorTotal)+' emitidos')
    + '</div>')
    : '<div class="footnote" style="margin-bottom:10px">Ainda não há pedidos de compra registrados para este fornecedor — o desempenho (prazo de entrega e qualidade) aparece aqui assim que houver recebimentos.</div>';

  return ''
    + '<div class="modal-backdrop" id="fornecedor-modal-backdrop">'
    + '  <div class="modal">'
    + '    <div class="modal-head"><h2 style="font-size:17px">'+esc(titleCase(s.nome))+'</h2><button class="modal-close" data-close-fornecedor>'+icon('close')+'</button></div>'
    + (av.razaoSocial||av.cnpj ? '<div class="footnote" style="padding:0 20px;margin-top:-4px">'+(av.razaoSocial?esc(av.razaoSocial):'')+(av.razaoSocial&&av.cnpj?' · ':'')+(av.cnpj?'CNPJ '+esc(av.cnpj):'')+'</div>' : '')
    + '    <div class="modal-body">'
    + '      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'
    + '        '+kpiTile('Gasto total', money(s.spend), num(s.nPedidos)+' pedidos')
    + '        '+kpiTile('Itens fornecidos', num(s.nProdutos), 'no histórico')
    + '        '+kpiTile('Período', dateBR(s.primeiro), 'até '+dateBR(s.ultimo))
    + '      </div>'
    + '      <div class="field-label" style="font-size:12.5px;font-weight:600;color:var(--ink-muted);margin-bottom:4px">Desempenho do fornecedor</div>'
    + desempHtml
    + codigosNote
    + '      <div class="qform">'
    + '      <div class="field" style="display:flex;gap:8px"><div style="flex:1.4"><label>Razão social (opcional)</label><input type="text" id="input-fornecedor-razao-social" placeholder="Razão social conforme contrato social" value="'+esc(av.razaoSocial||'')+'" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + '        <div style="flex:1"><label>CNPJ (opcional)</label><input type="text" id="input-fornecedor-cnpj" placeholder="00.000.000/0000-00" value="'+esc(av.cnpj||'')+'" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div></div>'
    + '      <div class="field"><label>Condição de pagamento (opcional)</label><input type="text" id="input-fornecedor-condicao-pagamento" placeholder="Ex.: 30/60 dias, à vista, boleto 28 dias" value="'+esc(av.condicaoPagamento||'')+'" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + (av.contatoNome||av.telefone||av.email ? '<div class="ref-price-box">'+(av.contatoNome?'<strong>'+esc(av.contatoNome)+'</strong> - ':'')+(av.telefone?esc(av.telefone):'')+(av.telefone&&av.email?' - ':'')+(av.email?esc(av.email):'')+'</div>' : '')
    + '      <div class="field" style="margin-top:10px"><label>Avaliação</label><div class="avaliacao-row"><span class="stars">'+stars+'</span><span class="footnote" style="margin:0">'+(av.nota?av.nota+'/5':'sem nota ainda')+'</span></div></div>'
    + '      <div class="field"><label>Status de homologação</label>'
    + '        <select class="filter-select" id="select-fornecedor-status" data-status-fornecedor="'+esc(codigo)+'">'
    + '          <option value="nao_avaliado"'+(av.status==='nao_avaliado'?' selected':'')+'>Não avaliado</option>'
    + '          <option value="homologado"'+(av.status==='homologado'?' selected':'')+'>Homologado</option>'
    + '          <option value="avaliacao"'+(av.status==='avaliacao'?' selected':'')+'>Em avaliação</option>'
    + '          <option value="bloqueado"'+(av.status==='bloqueado'?' selected':'')+'>Bloqueado</option>'
    + '        </select></div>'
    + '      <div class="field"><label>Observações</label><textarea class="obs-input" id="textarea-fornecedor-obs" placeholder="Ex.: bom prazo de entrega, negociar frete, atraso recorrente...">'+esc(av.obs||'')+'</textarea></div>'
    + '      <div class="divider"></div>'
    + '      <div class="field"><label>Contato comercial</label><div style="display:flex;gap:8px">'
    + '        <input type="text" id="input-fornecedor-contato-nome" placeholder="Nome do vendedor/representante" value="'+esc(av.contatoNome||'')+'" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '      </div></div>'
    + '      <div class="field"><div style="display:flex;gap:8px">'
    + '        <input type="text" id="input-fornecedor-telefone" placeholder="Telefone" value="'+esc(av.telefone||'')+'" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '        <input type="text" id="input-fornecedor-email" placeholder="E-mail" value="'+esc(av.email||'')+'" style="flex:1.4;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '      </div></div>'
    + '      <div class="field"><label>Endereço (opcional)</label><input type="text" id="input-fornecedor-endereco" placeholder="Rua, número, bairro" value="'+esc(av.endereco||'')+'" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + '      <div class="field"><label>Cidade / UF</label><div style="display:flex;gap:8px">'
    + '        <input type="text" id="input-fornecedor-cidade" placeholder="Cidade" value="'+esc(av.cidade||'')+'" style="flex:2;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '        <input type="text" id="input-fornecedor-uf" placeholder="UF" maxlength="2" value="'+esc(av.uf||'')+'" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px;text-transform:uppercase">'
    + '      </div>'
    + '      </div>'
    + '      <div class="field"><label>Situação fiscal</label>'
    + '        <select class="filter-select" id="select-fornecedor-fiscal">'
    + '          <option value="nao_verificado"'+(!av.situacaoFiscal||av.situacaoFiscal==='nao_verificado'?' selected':'')+'>Não verificado</option>'
    + '          <option value="regular"'+(av.situacaoFiscal==='regular'?' selected':'')+'>Regular (CND/certidões em dia)</option>'
    + '          <option value="pendente"'+(av.situacaoFiscal==='pendente'?' selected':'')+'>Pendência identificada</option>'
    + '        </select></div>'
    + '      <div class="field"><label>Certificações</label>'
    + '        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px"><input type="checkbox" id="chk-fornecedor-iso9001" '+(av.certISO9001?'checked':'')+'> <span class="footnote" style="margin:0">ISO 9001</span></label>'
    + '        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:4px"><input type="checkbox" id="chk-fornecedor-laudo" '+(av.certLaudo?'checked':'')+'> <span class="footnote" style="margin:0">Laudo de material / certificado de qualidade</span></label>'
    + '        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="chk-fornecedor-seguro" '+(av.certSeguroRC?'checked':'')+'> <span class="footnote" style="margin:0">Seguro de responsabilidade civil</span></label>'
    + '      </div>'
    + '      <div class="field"><label>Validade da certificação (opcional)</label><input type="date" id="input-fornecedor-cert-validade" value="'+esc(av.certValidade||'')+'"></div>'
    + '      <div class="field"><label>Anexar certificado / documento (opcional, até ~700KB)</label><input type="file" id="input-fornecedor-anexo" accept="image/*,.pdf">'+(av.certificadoAnexo?'<div class="footnote">Arquivo anexado: '+esc(av.certificadoAnexo.nome)+'</div>':'')+'</div>'
    + '      <div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:0"><input type="checkbox" id="chk-fornecedor-esg" '+(av.esgPolitica?'checked':'')+'> <span>Possui política ESG conhecida</span></label></div>'
    + '      <div class="field"><label>Observações ESG (opcional)</label><textarea class="obs-input" id="textarea-fornecedor-esg-obs" placeholder="Ex.: programa de reciclagem, certificação ambiental...">'+esc(av.esgObs||'')+'</textarea></div>'
    + '      <div class="divider"></div>'
    + '      <div class="field"><label>Principais itens fornecidos</label>'+itensHtml+'</div>'
    + '      </div>'
    + '      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    + '        <button class="btn secondary" data-close-fornecedor>Fechar</button>'
    + '        <button class="btn" data-save-fornecedor="'+esc(codigo)+'">Salvar avaliação</button>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>';
}

/* Formulário de cadastro de um fornecedor novo, fora da importação do ERP. Reaproveita os
   mesmos campos/estilos do modal de avaliação acima, para que um fornecedor cadastrado à
   mão fique com a mesma ficha cadastral completa de um importado do ERP. */
function renderNovoFornecedorModal(){
  if(!UI.novoFornecedorAberto) return '';
  return ''
    + '<div class="modal-backdrop" id="novo-fornecedor-modal-backdrop">'
    + '  <div class="modal">'
    + '    <div class="modal-head"><h2 style="font-size:17px">Novo fornecedor</h2><button class="modal-close" data-close-novo-fornecedor>'+icon('close')+'</button></div>'
    + '    <div class="footnote" style="padding:0 20px;margin-top:-4px">Cadastre um fornecedor que ainda não está no ERP, com os mesmos dados de um cadastro importado.</div>'
    + '    <div class="modal-body">'
    + '      <div class="qform">'
    + '      <div class="field"><label>Nome do fornecedor *</label><input type="text" id="input-novo-fornecedor-nome" placeholder="Nome como deve aparecer nas listas" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + '      <div class="field" style="display:flex;gap:8px"><div style="flex:1.4"><label>Razão social (opcional)</label><input type="text" id="input-novo-fornecedor-razao-social" placeholder="Razão social conforme contrato social" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + '        <div style="flex:1"><label>CNPJ (opcional)</label><input type="text" id="input-novo-fornecedor-cnpj" placeholder="00.000.000/0000-00" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div></div>'
    + '      <div class="field"><label>Condição de pagamento (opcional)</label><input type="text" id="input-novo-fornecedor-condicao-pagamento" placeholder="Ex.: 30/60 dias, à vista, boleto 28 dias" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + '      <div class="field"><label>Status de homologação</label>'
    + '        <select class="filter-select" id="select-novo-fornecedor-status">'
    + '          <option value="nao_avaliado" selected>Não avaliado</option>'
    + '          <option value="homologado">Homologado</option>'
    + '          <option value="avaliacao">Em avaliação</option>'
    + '          <option value="bloqueado">Bloqueado</option>'
    + '        </select></div>'
    + '      <div class="field"><label>Observações (opcional)</label><textarea class="obs-input" id="textarea-novo-fornecedor-obs" placeholder="Ex.: indicado por..., especializado em..."></textarea></div>'
    + '      <div class="divider"></div>'
    + '      <div class="field"><label>Contato comercial (opcional)</label><div style="display:flex;gap:8px">'
    + '        <input type="text" id="input-novo-fornecedor-contato-nome" placeholder="Nome do vendedor/representante" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '      </div></div>'
    + '      <div class="field"><div style="display:flex;gap:8px">'
    + '        <input type="text" id="input-novo-fornecedor-telefone" placeholder="Telefone" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '        <input type="text" id="input-novo-fornecedor-email" placeholder="E-mail" style="flex:1.4;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '      </div></div>'
    + '      <div class="field"><label>Endereço (opcional)</label><input type="text" id="input-novo-fornecedor-endereco" placeholder="Rua, número, bairro" style="width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"></div>'
    + '      <div class="field"><label>Cidade / UF</label><div style="display:flex;gap:8px">'
    + '        <input type="text" id="input-novo-fornecedor-cidade" placeholder="Cidade" style="flex:2;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px">'
    + '        <input type="text" id="input-novo-fornecedor-uf" placeholder="UF" maxlength="2" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px;text-transform:uppercase">'
    + '      </div>'
    + '      </div>'
    + '      </div>'
    + '      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    + '        <button class="btn secondary" data-close-novo-fornecedor>Cancelar</button>'
    + '        <button class="btn" id="btn-salvar-novo-fornecedor">Cadastrar fornecedor</button>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   TAB: Itens & Matriz de criticidade
   ============================================================ */
function renderItens(){
  var f = UI.itens;
  var quadCounts = { estrategico:0, alavancagem:0, gargalo:0, rotina:0 };
  var quadSpend = { estrategico:0, alavancagem:0, gargalo:0, rotina:0 };
  produtosAtivos().forEach(function(p){ quadCounts[p.quadrante]++; quadSpend[p.quadrante]+=p.spend; });

  var quadCards = ['estrategico','alavancagem','gargalo','rotina'].map(function(q){
    return '<div class="card" style="padding:14px 16px">'
      + '<div class="quad-tag quad-'+q+'" style="font-size:13.5px;margin-bottom:4px"><span class="quad-dot"></span>'+QUAD_LABELS[q]+'</div>'
      + '<div class="kpi-value" style="font-size:20px">'+num(quadCounts[q])+' itens</div>'
      + '<div class="kpi-note">'+money(quadSpend[q])+'</div>'
      + '<div class="footnote" style="margin-top:6px">'+QUAD_DESC[q]+'</div>'
      + '</div>';
  }).join('');

  var scatterHtml = renderScatter();

  var list = filteredProdutos();
  var visible = list.slice(0, f.limit);
  function th(key, label, numeric){
    var arrow = f.sortKey===key ? (f.sortDir==='asc'?'▲':'▼') : '';
    return '<th class="sortable'+(numeric?' num':'')+'" data-sort-item="'+key+'">'+label+' <span class="sort-arrow">'+arrow+'</span></th>';
  }
  var rows = visible.map(function(p){
    return '<tr>'
      + '<td><div class="cell-primary">'+esc(titleCase(p.descricao))+'</div><div class="cell-sub">'+(p.codigo?'Cód. '+esc(p.codigo)+' · ':'')+tipoLabel(p.tipo)+'</div></td>'
      + '<td class="num">'+num(p.nPedidos)+'</td>'
      + '<td class="num">'+num(p.nFornecedores)+'</td>'
      + '<td class="num">'+money(p.spend)+'</td>'
      + '<td class="num">'+moneyCents(p.precoMedio)+'</td>'
      + '<td>'+quadTag(p.quadrante)+'</td>'
      + '</tr>';
  }).join('');

  var quadChips = ['todos','estrategico','alavancagem','gargalo','rotina'].map(function(q){
    var label = q==='todos' ? 'Todos' : QUAD_LABELS[q];
    return '<button class="chip'+(f.quadrante===q?' active':'')+'" data-item-quad="'+q+'">'+label+'</button>';
  }).join('');

  return ''
    + '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">'+quadCards+'</div>'
    + '<div class="card" style="margin-top:16px">'
    + '  <div class="card-head"><h2>Matriz de criticidade (Kraljic)</h2><span class="hint">eixo horizontal: nº de fornecedores · eixo vertical: gasto (escala log)</span></div>'
    + scatterHtml
    + '</div>'
    + '<div class="card">'
    + '  <div class="toolbar">'
    + '    <input type="text" class="search-input" id="input-item-search" placeholder="Buscar item por nome ou código..." value="'+esc(f.search)+'">'
    + '    <div class="chip-row">'+quadChips+'</div>'
    + '  </div>'
    + '  <div class="table-wrap table-scroll"><table class="data"><thead><tr>'
    + '<th>Item</th>'+th('nPedidos','Pedidos',1)+th('nFornecedores','Fornec.',1)+th('spend','Gasto',1)+th('precoMedio','Preço médio',1)+'<th>Quadrante</th>'
    + '</tr></thead><tbody>'+(rows||'<tr><td colspan="6"><div class="empty-state">'+icon('search')+'<div>Nenhum item encontrado.</div></div></td></tr>')+'</tbody></table></div>'
    + (list.length>visible.length ? '<div style="text-align:center;margin-top:12px"><button class="btn secondary small" id="btn-itens-mais">Mostrar mais ('+ (list.length-visible.length) +' restantes)</button></div>' : '')
    + '</div>';
}

function renderScatter(){
  var buckets = ['1','2','3-4','5+'];
  var bucketLabel = { '1':'1 fornecedor', '2':'2 fornecedores', '3-4':'3–4 fornecedores', '5+':'5+ fornecedores' };
  var minSpendForPlot = 300;
  var pts = produtosAtivos().filter(function(p){ return p.spend>minSpendForPlot; });
  var covered = pts.reduce(function(a,b){return a+b.spend;},0);
  var totalSpend = produtosAtivos().reduce(function(a,b){return a+b.spend;},0);

  if(!pts.length){
    return '<div class="empty-state">'+icon('search')+'<div>Ainda não há histórico de gasto suficiente para montar a matriz de criticidade.</div></div>';
  }

  function bucketOf(n){ if(n===1) return '1'; if(n===2) return '2'; if(n<=4) return '3-4'; return '5+'; }
  var maxSpend = Math.max.apply(null, pts.map(function(p){return p.spend;}));
  var minSpend = Math.min.apply(null, pts.map(function(p){return p.spend;}));
  var W = 860, H = 380, padL = 56, padR = 20, padT = 16, padB = 40;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  var colW = plotW / buckets.length;

  function yFor(spend){ var logMin = Math.log10(minSpend), logMax = Math.log10(maxSpend); var range = logMax-logMin; var t = range>0 ? (Math.log10(spend)-logMin)/range : 0.5; return padT + plotH - t*plotH; }
  function xFor(bucketIdx, seed){ var jitter = ((seed*97)%100)/100 * (colW*0.62) - (colW*0.31); return padL + bucketIdx*colW + colW/2 + jitter; }

  var circles = pts.map(function(p, i){
    var b = bucketOf(p.nFornecedores);
    var bi = buckets.indexOf(b);
    var cx = xFor(bi, i+ (p.codigo? p.codigo.length:1) + p.spend);
    var cy = yFor(Math.max(p.spend, minSpend));
    var r = Math.max(2.6, Math.min(11, Math.sqrt(p.spend)/16));
    var color = 'var(--steel)';
    if(p.quadrante==='estrategico') color='var(--critical)';
    else if(p.quadrante==='alavancagem') color='var(--good)';
    else if(p.quadrante==='gargalo') color='var(--warning)';
    return '<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+r.toFixed(1)+'" fill="'+color+'" fill-opacity="0.62" stroke="'+color+'" stroke-width="1" data-pt-codigo="'+esc(itemAggKey(p))+'"></circle>';
  }).join('');

  var xLabels = buckets.map(function(b,i){ var cx = padL + i*colW + colW/2; return '<text x="'+cx+'" y="'+(H-14)+'" text-anchor="middle" class="scatter-axis-label">'+bucketLabel[b]+'</text>'; }).join('');
  var yTicks = [minSpend, Math.sqrt(minSpend*maxSpend), maxSpend];
  var yLabels = yTicks.map(function(v){ var y = yFor(v); return '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+y.toFixed(1)+'" stroke="var(--gridline)" stroke-width="1"></line><text x="'+(padL-8)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" class="scatter-axis-label">'+money(v)+'</text>'; }).join('');
  var colDividers = buckets.slice(1).map(function(b,i){ var x = padL + (i+1)*colW; return '<line x1="'+x+'" y1="'+padT+'" x2="'+x+'" y2="'+(padT+plotH)+'" stroke="var(--gridline)" stroke-width="1" stroke-dasharray="3,3"></line>'; }).join('');

  return ''
    + '<div class="scatter-wrap">'
    + '<style>.scatter-axis-label{font:11px "IBM Plex Mono",monospace;fill:var(--ink-muted);} </style>'
    + '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto" id="scatter-svg">'
    + yLabels + colDividers + '<g>'+circles+'</g>' + xLabels
    + '</svg>'
    + '<div id="scatter-tooltip" class="scatter-tooltip" style="display:none"></div>'
    + '</div>'
    + '<div class="quad-legend">'
    + '<span class="quad-tag quad-estrategico"><span class="quad-dot"></span>Estratégico (alto gasto, 1 fornecedor)</span>'
    + '<span class="quad-tag quad-alavancagem"><span class="quad-dot"></span>Alavancagem (alto gasto, vários fornecedores)</span>'
    + '<span class="quad-tag quad-gargalo"><span class="quad-dot"></span>Gargalo (baixo gasto, 1 fornecedor)</span>'
    + '<span class="quad-tag quad-rotina"><span class="quad-dot"></span>Rotina</span>'
    + '</div>'
    + '<div class="footnote">Exibindo os '+num(pts.length)+' itens com gasto acima de '+money(minSpendForPlot)+' no período — '+fmtPct(covered/totalSpend*100,1)+' do valor total comprado. A tabela abaixo traz todos os '+num(produtosAtivos().length)+' itens.</div>';
}

/* ============================================================
   TAB: Cotações (com aprovação por alçada)
   ============================================================ */
function renderCotacoes(){
  var c = UI.cotacoes;
  var list = STATE.cotacoes.slice().sort(function(a,b){ return b.criadoEm.localeCompare(a.criadoEm); });
  if(c.filtro==='abertas') list = list.filter(function(x){return cotacaoStatusGeral(x)==='aberta';});
  if(c.filtro==='aprovacao') list = list.filter(function(x){return cotacaoStatusGeral(x)==='aguardando_aprovacao';});
  if(c.filtro==='recusadas') list = list.filter(function(x){return cotacaoStatusGeral(x)==='recusada';});
  if(c.filtro==='aprovadas') list = list.filter(function(x){return cotacaoStatusGeral(x)==='aprovada';});

  var chips = [['abertas','Abertas'],['aprovacao','Aguardando aprovação'],['recusadas','Recusadas'],['aprovadas','Aprovadas'],['todas','Todas']].map(function(pair){
    return '<button class="chip'+(c.filtro===pair[0]?' active':'')+'" data-cotacao-filtro="'+pair[0]+'">'+pair[1]+'</button>';
  }).join('');

  var cardsHtml = list.map(renderCotacaoCard).join('') || '<div class="empty-state">'+icon('scale')+'<div>Nenhuma cotação nesta lista ainda.</div></div>';

  return ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Nova cotação</h2><span class="hint">registre os preços recebidos e compare com o histórico</span></div>'
    + (c.showForm ? renderCotacaoForm() : '<button class="btn" id="btn-abrir-cotacao">'+icon('plus')+' Registrar cotação</button>')
    + '</div>'
    + '<div class="card">'
    + '  <div class="card-head"><h2>Mínimo de cotações</h2><span class="hint">todo item já exige no mínimo '+MIN_ORCAMENTOS+' orçamentos com foto — aqui dá para exigir mais, para compras de maior valor</span></div>'
    + '  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="footnote" style="margin:0">Compras acima de</span>'
    + '  <input type="text" inputmode="decimal" id="input-min-cot-valor" value="'+esc(String(STATE.configAprovacao.minCotacoesValor).replace('.',','))+'" style="width:120px;padding:6px 9px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:\'IBM Plex Mono\',monospace">'
    + '  <span class="footnote" style="margin:0">exigem no mínimo</span>'
    + '  <input type="text" inputmode="numeric" id="input-min-cot-qtd" value="'+esc(STATE.configAprovacao.minCotacoesQtd)+'" style="width:60px;padding:6px 9px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:\'IBM Plex Mono\',monospace">'
    + '  <span class="footnote" style="margin:0">cotações de fornecedores diferentes.</span>'
    + '  <button class="btn secondary small" id="btn-salvar-min-cot">Salvar</button></div>'
    + '  <div class="footnote" style="margin-top:8px">Se o administrador aceitar um orçamento com menos cotações do que o exigido aqui, o painel vai pedir uma justificativa antes de seguir.</div>'
    + '</div>'
    + '<div class="card">'
    + '  <div class="toolbar"><div class="chip-row">'+chips+'</div></div>'
    + '  ' + cardsHtml
    + '</div>';
}

function renderCotacaoForm(){
  var c = UI.cotacoes;
  var obrasAtivas = STATE.obras.filter(function(o){return o.status==='ativa';});
  var obraOptions = '<option value="">Sem obra vinculada</option>' + obrasAtivas.map(function(o){ return '<option value="'+esc(o.id)+'"'+(c.formObraId===o.id?' selected':'')+'>'+esc(o.nome)+'</option>'; }).join('');

  var itensHtml = c.formItensCotados.map(function(item, idx){
    var sel = item.itemSel;
    var results = produtoTypeaheadResults(item.itemBusca);
    var catalogNorms = results.map(function(p){ return normalize(p.descricao); });
    var customResults = item.dismissSuggestions ? [] : itemPersonalizadoTypeaheadResults(item.itemBusca, catalogNorms);
    var showResults = item.dismissSuggestions ? [] : results;
    var refBox = '';
    if(sel){
      var forn = sel.fornecedores.slice(0,4).map(function(fn){ return fn.nome + ': ' + moneyCents(fn.precoMedio) + ' (' + fn.nPedidos + 'x)'; }).join(' · ');
      refBox = '<div class="ref-price-box"><strong>Referência histórica:</strong> preço médio '+moneyCents(sel.precoMedio)+' · variação '+sel.precoMin.toFixed(2).replace('.',',')+'–'+sel.precoMax.toFixed(2).replace('.',',')+' · fornecedores anteriores: '+ (forn||'nenhum registrado') +'</div>';
    }
    var linhasHtml = item.linhas.map(function(linha, lidx){
      var fotoSlot = '<label class="quote-photo-slot'+(linha.foto?' has-photo':'')+'" title="'+(linha.foto?'Foto anexada — clique para trocar':'Anexar foto do item para este orçamento')+'">'
        + (linha.foto ? '<img src="'+linha.foto+'" alt="Foto do orçamento">' : icon('image'))
        + '<input type="file" accept="image/*" data-quote-foto data-item-idx="'+idx+'" data-quote-idx="'+lidx+'">'
        + '</label>';
      return '<div class="quote-line">'
        + '<input type="text" placeholder="Nome do fornecedor" data-quote-field="fornecedor" data-item-idx="'+idx+'" data-quote-idx="'+lidx+'" value="'+esc(linha.fornecedor)+'">'
        + '<input type="text" inputmode="decimal" placeholder="Preço unit. (R$)" data-quote-field="preco" data-item-idx="'+idx+'" data-quote-idx="'+lidx+'" value="'+esc(linha.preco)+'">'
        + '<input type="text" inputmode="numeric" placeholder="Prazo (dias)" data-quote-field="prazo" data-item-idx="'+idx+'" data-quote-idx="'+lidx+'" value="'+esc(linha.prazo)+'">'
        + fotoSlot
        + (item.linhas.length>MIN_ORCAMENTOS ? '<button class="icon-btn" data-remove-quote-line data-item-idx="'+idx+'" data-quote-idx-rm="'+lidx+'">'+icon('trash')+'</button>' : '<span></span>')
        + '</div>';
    }).join('');

    var qtd = parseNum(item.qtd);
    var menorPreco = item.linhas.map(function(l){return parseNum(l.preco);}).filter(function(v){return v>0;}).sort(function(a,b){return a-b;})[0];
    var valorEstimado = (qtd>0 && menorPreco) ? qtd*menorPreco : null;

    return '<div class="card" style="background:var(--surface-2);margin-bottom:12px;padding:14px 16px">'
      + (c.formItensCotados.length>1 ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span class="footnote" style="margin:0;font-weight:600">Item '+(idx+1)+'</span><button class="icon-btn" data-remove-cotacao-item="'+idx+'" title="Remover item">'+icon('trash')+'</button></div>' : '')
      + '  <div class="field typeahead">'
      + '    <label>Item</label>'
      + '    <input type="text" data-cotacao-item-search data-item-idx="'+idx+'" placeholder="Digite livremente a descrição do item..." value="'+esc(item.itemBusca)+'" autocomplete="off">'
      + (showResults.length || customResults.length ? '<div class="typeahead-list">'
          + showResults.map(function(p){ return '<div class="typeahead-item" data-pick-item="'+esc(itemAggKey(p))+'" data-item-idx="'+idx+'">'+(p.codigo?'<span class="code">'+esc(p.codigo)+'</span> — ':'')+esc(titleCase(p.descricao))+'</div>'; }).join('')
          + customResults.map(function(it){ return '<div class="typeahead-item" data-pick-item-custom="'+esc(it.descricao)+'" data-item-idx="'+idx+'">'+esc(it.descricao)+' <span class="cell-sub">(já usado antes)</span></div>'; }).join('')
          + '</div>' : '')
      + (sel ? '<div class="footnote" style="margin-top:4px">'+(sel.codigo ? 'Vinculado ao item do catálogo <strong>'+esc(sel.codigo)+'</strong>.' : 'Vinculado ao histórico de compras deste item.')+' Continue editando o texto para digitar algo diferente.</div>' : '')
      + '  </div>'
      + (sel ? refBox : '')
      + '  <div class="field" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + '    <div><label>Quantidade desejada</label><input type="text" inputmode="decimal" data-cotacao-qtd data-item-idx="'+idx+'" placeholder="Ex.: 50" value="'+esc(item.qtd)+'"></div>'
      + '    <div><label>Unidade de medida</label><input type="text" data-cotacao-unidade data-item-idx="'+idx+'" placeholder="Ex.: un, kg, m, cx" value="'+esc(item.unidade||'')+'"></div>'
      + '  </div>'
      + '  <div class="field"><label>Orçamentos recebidos (mínimo '+MIN_ORCAMENTOS+', cada um com fornecedor, preço e foto do item)</label>'+linhasHtml
      + '    <button class="btn ghost small" data-add-quote-line="'+idx+'">'+icon('plus')+' Adicionar fornecedor</button>'
      + '  </div>'
      + (valorEstimado ? '<div class="ref-price-box">Valor estimado pelo menor preço: <strong>'+money(valorEstimado)+'</strong> — um administrador vai escolher qual orçamento aceitar antes de seguir com a compra.</div>' : '')
      + '</div>';
  }).join('');

  return ''
    + '<div class="qform">'
    + itensHtml
    + '  <button class="btn ghost small" id="btn-add-cotacao-item" style="margin-bottom:14px">'+icon('plus')+' Adicionar outro item nesta cotação</button>'
    + '  <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '    <div><label>Solicitante (opcional)</label><input type="text" id="input-cotacao-solicitante" placeholder="Nome de quem pediu a compra" value="'+esc(c.formSolicitante)+'"></div>'
    + '    <div><label>Setor (opcional)</label><input type="text" id="input-cotacao-setor" placeholder="Ex.: Manutenção, Obra X" value="'+esc(c.formSetor)+'"></div>'
    + '  </div>'
    + '  <div class="field"><label>Obra / centro de custo (opcional)</label><select class="filter-select" id="select-cotacao-obra">'+obraOptions+'</select></div>'
    + '  <div class="field" style="margin-top:12px"><label>Observações (opcional)</label><textarea class="obs-input" id="textarea-cotacao-obs" placeholder="Prazo de necessidade, condições de pagamento...">'+esc(c.formObs)+'</textarea></div>'
    + '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'
    + '    <button class="btn secondary" id="btn-cancelar-cotacao">Cancelar</button>'
    + '    <button class="btn" id="btn-salvar-cotacao">Salvar cotação</button>'
    + '  </div>'
    + '</div>';
}

function renderCotacaoItemBlock(cot, item, idx){
  var linhasOrdenadas = item.linhas.slice().sort(function(a,b){ return parseFloat(a.preco)-parseFloat(b.preco); });
  var menor = linhasOrdenadas.length ? parseFloat(linhasOrdenadas[0].preco) : null;
  var qtd = item.quantidade || 0;
  var isPendingException = UI.cotacoes.pendingExceptionId===cot.id && UI.cotacoes.pendingExceptionItemIdx===idx;
  var isPendingReject = UI.cotacoes.pendingRejectId===cot.id && UI.cotacoes.pendingRejectItemIdx===idx;

  var isPendingDecisao = item.status==='aberta' || item.status==='aguardando_aprovacao';

  var linhasHtml = linhasOrdenadas.map(function(l){
    var isWinner = item.vencedor===l.fornecedor;
    var isCheapest = menor!=null && parseFloat(l.preco)===menor;
    var fotoHtml = l.foto
      ? '<a href="'+l.foto+'" target="_blank" rel="noopener" title="Ver foto em tamanho maior"><img class="quote-photo-thumb" src="'+l.foto+'" alt="Foto do item — orçamento de '+esc(l.fornecedor)+'"></a>'
      : '<span class="quote-photo-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--ink-muted);background:var(--surface-2)">'+icon('image')+'</span>';
    return '<div class="bar-row" style="margin-bottom:6px">'
      + fotoHtml
      + '<div class="label" style="width:180px">'+esc(l.fornecedor)+(isWinner?' <span class="badge badge-good">vencedor</span>':'')+'</div>'
      + '<div class="bar-val" style="width:auto;flex:1;text-align:left">'+moneyCents(parseFloat(l.preco)||0)+(l.prazo?' · '+esc(l.prazo)+' dias':'')+(isCheapest && isPendingDecisao?' <span class="badge badge-accent">menor preço</span>':'')+'</div>'
      + (isPendingDecisao && !isPendingException && !isPendingReject && isAdmin() ? '<button class="btn ghost small" data-close-cotacao="'+cot.id+'" data-item-idx="'+idx+'" data-vencedor="'+esc(l.fornecedor)+'">Aceitar e dar continuidade</button>' : '')
      + '</div>';
  }).join('');

  var statusHtml;
  if(item.status==='aberta') statusHtml = '<span class="badge badge-warn">Aberta</span>';
  else if(item.status==='aguardando_aprovacao') statusHtml = '<span class="badge badge-crit">Aguardando aprovação</span>';
  else if(item.status==='recusada') statusHtml = '<span class="badge badge-crit">Recusada</span>';
  else statusHtml = '<span class="badge badge-good">Aprovada</span>';

  var valorTotal = (qtd && item.vencedor) ? qtd * (linhasOrdenadas.find(function(l){return l.fornecedor===item.vencedor;})||{preco:0}).preco*1 : null;

  var approvalBox = '';
  if(isPendingDecisao){
    if(isPendingReject){
      approvalBox = '<div class="ref-price-box" style="border-color:var(--critical)"><strong>Recusar esta cotação</strong>'
        + '<div class="field" style="margin-top:8px"><textarea class="obs-input" id="input-cotacao-reject-just" placeholder="Motivo da recusa (opcional)...">'+esc(UI.cotacoes.rejectText)+'</textarea></div>'
        + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'
        + '<button class="btn secondary small" id="btn-cancelar-recusa-cotacao">Cancelar</button>'
        + '<button class="btn small danger" data-confirmar-recusa-cotacao="'+cot.id+'" data-item-idx="'+idx+'">Confirmar recusa</button>'
        + '</div></div>';
    } else {
      var precosLinhas = item.linhas.map(function(l){return parseFloat(l.preco)||0;}).filter(function(v){return v>0;});
      var minP = precosLinhas.length ? Math.min.apply(null, precosLinhas) : 0;
      var maxP = precosLinhas.length ? Math.max.apply(null, precosLinhas) : 0;
      var faixaTxt = precosLinhas.length ? 'Preços recebidos entre '+moneyCents(minP)+' e '+moneyCents(maxP)+' (unitário)'+(qtd?' · total estimado entre '+money(qtd*minP)+' e '+money(qtd*maxP):'')+'.' : '';
      var tituloDecisao = item.linhas.length < MIN_ORCAMENTOS
        ? 'Cotação com menos do que o mínimo de '+MIN_ORCAMENTOS+' orçamentos (registro antigo).'
        : 'Escolha um dos orçamentos acima para dar continuidade ao pedido, ou recuse esta cotação.';
      approvalBox = '<div class="ref-price-box" style="border-color:var(--critical)"><strong>'+tituloDecisao+'</strong>'
        + (faixaTxt ? '<div class="footnote" style="margin-top:4px">'+faixaTxt+'</div>' : '')
        + (isAdmin()
            ? '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn small danger" data-recusar-cotacao="'+cot.id+'" data-item-idx="'+idx+'">Recusar cotação</button></div>'
            : '<div class="footnote" style="margin-top:6px">Somente um administrador pode aceitar um orçamento ou recusar esta cotação.</div>')
        + '</div>';
    }
  } else if(item.status==='recusada'){
    approvalBox = '<div class="ref-price-box" style="border-color:var(--critical)"><strong>Cotação recusada</strong> por '+esc(item.recusadoPor||'—')+' em '+dateBR(item.recusadoEm ? item.recusadoEm.slice(0,10) : '')+(item.motivoRecusa ? ' — motivo: "'+esc(item.motivoRecusa)+'"' : '')
      + (isAdmin() ? '<div style="margin-top:8px"><button class="btn secondary small" data-reabrir-cotacao="'+cot.id+'" data-item-idx="'+idx+'">Reabrir para nova cotação</button></div>' : '')
      + '</div>';
  } else if(item.status==='aprovada' && item.aprovadoPor){
    approvalBox = '<div class="footnote">Aprovado por '+esc(item.aprovadoPor)+' em '+dateBR(item.aprovadoEm ? item.aprovadoEm.slice(0,10) : '')+(valorTotal?' · valor total '+money(valorTotal):'')+'</div>'
      + renderAcompanhamentoChips(cot, item, idx);
  } else if(item.status==='aprovada'){
    approvalBox = '<div class="footnote">Aprovação automática — dentro da alçada do comprador'+(valorTotal?' · valor total '+money(valorTotal):'')+'.</div>'
      + renderAcompanhamentoChips(cot, item, idx);
  }

  var economiaBox = '';
  if(item.vencedor && typeof item.economiaEstimada==='number'){
    if(item.economiaEstimada>=0){
      economiaBox = '<div class="footnote"><span class="badge badge-good">economia estimada '+money(item.economiaEstimada)+'</span> vs. preço médio histórico ('+moneyCents(item.precoMedioReferencia)+')</div>';
    } else {
      economiaBox = '<div class="footnote"><span class="badge badge-warn">'+money(Math.abs(item.economiaEstimada))+' acima da média histórica</span> ('+moneyCents(item.precoMedioReferencia)+')</div>';
    }
  }

  var excecaoBox = item.justificativaExcecao ? '<div class="footnote">Fechada por exceção, com menos do que o mínimo de cotações exigido pela política — justificativa: "'+esc(item.justificativaExcecao)+'"</div>' : '';

  var exceptionForm = '';
  if(isPendingException){
    exceptionForm = '<div class="ref-price-box" style="border-color:var(--critical)">'
      + '<strong>Este item tem menos fornecedores do que o mínimo exigido pela política de compras</strong> (mínimo '+STATE.configAprovacao.minCotacoesQtd+' cotações para compras acima de '+money(STATE.configAprovacao.minCotacoesValor)+', este tem '+item.linhas.length+').'
      + '<div class="field" style="margin-top:8px"><textarea class="obs-input" id="input-cotacao-exception-just" placeholder="Justifique por que não foi possível obter o mínimo de cotações...">'+esc(UI.cotacoes.exceptionText)+'</textarea></div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'
      + '<button class="btn secondary small" id="btn-cancelar-excecao-cotacao">Cancelar</button>'
      + '<button class="btn small" data-confirmar-excecao-cotacao="'+cot.id+'" data-item-idx="'+idx+'">Registrar exceção e fechar</button>'
      + '</div></div>';
  }

  return '<div style="width:100%;'+(idx>0?'margin-top:14px;padding-top:14px;border-top:1px solid var(--border)':'')+'">'
    + '<div class="alert-title" style="font-size:13.5px;margin-bottom:6px">'+(item.itemCodigo?esc(item.itemCodigo)+' — ':'')+esc(titleCase(item.itemDescricao))+(qtd?' <span class="cell-sub">('+num1(qtd)+' '+(item.unidade?esc(item.unidade):'un.')+')</span>':'')+' '+statusHtml+'</div>'
    + linhasHtml
    + exceptionForm + approvalBox + economiaBox + excecaoBox
    + '</div>';
}

function renderCotacaoCard(cot){
  var itensHtml = (cot.itensCotados||[]).map(function(item, idx){ return renderCotacaoItemBlock(cot, item, idx); }).join('');
  return ''
    + '<div class="alert-card" style="align-items:flex-start;flex-direction:column;gap:8px">'
    + '  <div class="alert-meta" style="width:100%">Registrada em '+dateBR(cot.criadoEm.slice(0,10))+(cot.obraId && getObra(cot.obraId) ? ' · obra: '+esc(getObra(cot.obraId).nome) : '')+(cot.solicitante ? ' · solicitado por '+esc(cot.solicitante) : '')+(cot.setor ? ' ('+esc(cot.setor)+')' : '')+(cot.itensCotados && cot.itensCotados.length>1 ? ' · '+cot.itensCotados.length+' itens nesta cotação' : '')+'</div>'
    + itensHtml
    + (cot.obs ? '<div class="footnote">Obs.: '+esc(cot.obs)+'</div>' : '')
    + '</div>';
}

/* ============================================================
   TAB: Pedidos de compra + recebimento
   ============================================================ */
/* ============================================================
   TAB: Mapa Comparativo (comparação de fornecedores)
   ------------------------------------------------------------
   Herdado do aplicativo "Mapa de Cotações", que era um sistema separado: cada proposta
   recebida vira uma aba com a ficha do fornecedor e a lista de produtos cotados (com foto,
   quantidade, preço, desconto, frete, MOQ e impostos); a aba "Comparar" põe os itens
   escolhidos lado a lado, recomenda uma opção e registra a decisão com justificativa; a
   aba "Histórico" guarda cada comparação concluída.

   O que foi acrescentado nesta versão, além do sistema original:
   - vínculo com a base de fornecedores do ERP (preenche CNPJ, contato, condição de
     pagamento e status de homologação a partir do cadastro que já existe na aba
     Fornecedores, e mostra a classe ABC e o gasto histórico da empresa com aquele
     fornecedor dentro da comparação);
   - preço unitário líquido (total com desconto e frete dividido pela quantidade), que é o
     único jeito honesto de comparar propostas com quantidades diferentes;
   - pontuação de custo-benefício com pesos explícitos (preço, prazo de entrega, condição
     de pagamento, homologação e validade da proposta), mostrada lado a lado com a
     recomendação por menor preço;
   - indicadores no topo da aba e economia acumulada no histórico;
   - "copiar item já cotado" ao adicionar um produto, para não redigitar a mesma peça em
     cada fornecedor;
   - geração de um card de Agendamento de Compras direto do vencedor.
   ============================================================ */

var CMP_UNIDADES = [
  ['UN','UN — Unidade'], ['PÇ','PÇ — Peça'], ['CX','CX — Caixa'], ['PCT','PCT — Pacote'],
  ['PAR','PAR — Par'], ['KG','KG — Quilograma'], ['G','G — Grama'], ['TON','TON — Tonelada'],
  ['L','L — Litro'], ['ML','ML — Mililitro'], ['M','M — Metro'], ['CM','CM — Centímetro'],
  ['MM','MM — Milímetro'], ['M²','M² — Metro quadrado'], ['M³','M³ — Metro cúbico'],
  ['ROLO','ROLO'], ['SACO','SACO'], ['FARDO','FARDO'], ['DZ','DZ — Dúzia'], ['CENTO','CENTO'],
  ['RESMA','RESMA'], ['GL','GL — Galão'], ['BOBINA','BOBINA'], ['KIT','KIT'],
  ['CJ','CJ — Conjunto'], ['SERV','SERV — Serviço / verba'], ['LOTE','LOTE']
];
/* Pesos da pontuação de custo-benefício. Somam 100 e ficam visíveis na tela de propósito:
   uma recomendação de compra que ninguém consegue auditar não serve para justificar
   decisão nenhuma. */
var CMP_PESOS = [
  ['preco', 'Preço', 50],
  ['prazo', 'Prazo de entrega', 20],
  ['pagamento', 'Condição de pagamento', 15],
  ['homologacao', 'Homologação', 10],
  ['validade', 'Validade da proposta', 5]
];
var CMP_MAX_ANEXO = 900*1024;

function cmpUnidadeConhecida(v){
  var n = String(v||'').trim().toUpperCase();
  if(!n) return true;
  return CMP_UNIDADES.some(function(o){ return o[0]===n; });
}
function cmpUnidadeOptions(atual){
  var n = String(atual||'').trim().toUpperCase();
  var conhecida = cmpUnidadeConhecida(atual);
  var html = '<option value=""'+(!n?' selected':'')+'>Selecione…</option>';
  CMP_UNIDADES.forEach(function(o){
    html += '<option value="'+esc(o[0])+'"'+(n===o[0]?' selected':'')+'>'+esc(o[1])+'</option>';
  });
  html += '<option value="__outra__"'+(n && !conhecida ? ' selected':'')+'>Outra (digitar)…</option>';
  return html;
}

/* ---------- acesso ao modelo ---------- */
function cmpNum(v){ var n = Number(v); return isFinite(n) ? n : 0; }
function cmpFornecedorPorId(fid){ return STATE.comparativo.fornecedores.find(function(f){ return f.id===fid; }) || null; }
function cmpProdutosDe(fid){ return STATE.comparativo.produtos[fid] || []; }
function cmpProdutoPorId(fid, pid){ return cmpProdutosDe(fid).find(function(p){ return p.id===pid; }) || null; }
function cmpChave(fid, pid){ return fid+'|'+pid; }
function cmpGerarId(prefixo){
  STATE.comparativo.seq = (STATE.comparativo.seq||0) + 1;
  return prefixo+'_'+Date.now().toString(36)+'_'+STATE.comparativo.seq.toString(36);
}

/* ---------- cálculo de valores ---------- */
function cmpSubtotal(p){ return p ? cmpNum(p.qtd)*cmpNum(p.precoUnit) : 0; }
function cmpValorDesconto(p){
  if(!p) return 0;
  var pct = Math.min(100, Math.max(0, cmpNum(p.descontoPct)));
  return cmpSubtotal(p)*(pct/100);
}
function cmpTotalLinha(p){ return p ? (cmpSubtotal(p) - cmpValorDesconto(p) + cmpNum(p.frete)) : 0; }
/* Preço unitário líquido: total já com desconto e frete, dividido pela quantidade. É o
   número que permite comparar de verdade duas propostas com quantidades diferentes —
   comparar só o valor total, nesse caso, premia quem cotou menos peças. */
function cmpUnitLiquido(p){ var q = cmpNum(p && p.qtd); return q>0 ? cmpTotalLinha(p)/q : 0; }
function cmpTemFrete(p){ return !!(p && cmpNum(p.frete)>0); }
function cmpTemDesconto(p){ return !!(p && cmpNum(p.descontoPct)>0); }
function cmpTotalFornecedor(fid){
  return cmpProdutosDe(fid).reduce(function(s,p){ return s + cmpTotalLinha(p); }, 0);
}

/* ---------- ficha do fornecedor cotado ---------- */
function cmpPrazoDias(f){
  if(!f || f.prazoDias===''||f.prazoDias==null) return null;
  var n = Number(f.prazoDias); return isFinite(n) ? n : null;
}
function cmpPrazoLabel(f){
  var d = cmpPrazoDias(f);
  if(d==null) return '';
  return d + ' ' + (f.prazoTipo==='corridos' ? 'dias corridos' : 'dias úteis');
}
function cmpPagDias(f){
  if(!f || f.pagamentoDias===''||f.pagamentoDias==null) return null;
  var n = Number(f.pagamentoDias); return isFinite(n) ? n : null;
}
function cmpPagLabel(f){
  if(!f) return '';
  if(f.pagamentoTexto) return f.pagamentoTexto;
  var d = cmpPagDias(f);
  return d!=null ? d+' dias' : '';
}
function cmpPropostaVencida(f){ return !!(f && f.validadeProposta && f.validadeProposta < todayISO()); }
/* Fornecedor do ERP ao qual esta proposta está vinculada (se houver). */
function cmpFornecedorErp(f){
  if(!f || !f.codigoErp) return null;
  return STATE.fornecedores.find(function(s){ return s.codigo===f.codigoErp; }) || null;
}
/* Quando a proposta está vinculada a um fornecedor do ERP, o status de homologação sai da
   ficha cadastral daquele fornecedor (aba Fornecedores) — nunca de um campo digitado
   separadamente aqui, senão as duas telas passariam a discordar uma da outra. */
function cmpStatusEfetivo(f){
  var erp = cmpFornecedorErp(f);
  if(erp){
    var st = getAvaliacao(erp.codigo).status;
    if(st==='homologado') return 'homologado';
    if(st==='bloqueado') return 'bloqueado';
  }
  return (f && f.status==='homologado') ? 'homologado' : 'novo';
}
function cmpStatusLabel(f){
  var st = cmpStatusEfetivo(f);
  return st==='homologado' ? 'Homologado' : st==='bloqueado' ? 'Bloqueado' : 'Novo';
}
function cmpStatusBadge(f){
  var st = cmpStatusEfetivo(f);
  var cls = st==='homologado' ? 'badge-good' : st==='bloqueado' ? 'badge-crit' : 'badge-neutral';
  return '<span class="badge '+cls+'">'+cmpStatusLabel(f)+'</span>';
}
function cmpNomeFornecedor(f){ return (f && f.nome) ? f.nome : 'Fornecedor'; }
function cmpNomeProduto(p){ return (p && p.nome) ? p.nome : 'Produto'; }

/* ---------- itens marcados para comparação ---------- */
function cmpItensSelecionados(){
  return Object.keys(STATE.comparativo.selecionados).map(function(k){
    var partes = k.split('|');
    var f = cmpFornecedorPorId(partes[0]);
    var p = cmpProdutoPorId(partes[0], partes[1]);
    if(!f || !p) return null;
    return {
      fid: partes[0], pid: partes[1], chave: k,
      fornecedor: f, produto: p,
      total: cmpTotalLinha(p), unitLiquido: cmpUnitLiquido(p)
    };
  }).filter(Boolean).sort(function(a,b){ return a.total - b.total; });
}
/* Remove do comparativo itens cujo produto ou fornecedor deixou de existir. */
function cmpLimparSelecao(){
  var mudou = false, limpo = {};
  Object.keys(STATE.comparativo.selecionados).forEach(function(k){
    var partes = k.split('|');
    if(cmpProdutoPorId(partes[0], partes[1])) limpo[k] = true; else mudou = true;
  });
  if(mudou) STATE.comparativo.selecionados = limpo;
  return mudou;
}

/* Base justa de comparação: se todas as propostas têm quantidade e as quantidades são
   diferentes entre si, comparamos por preço unitário líquido; caso contrário, pelo total
   (que, com quantidades iguais, dá exatamente a mesma ordem). */
function cmpBaseComparacao(itens){
  var todasComQtd = itens.length>0 && itens.every(function(it){ return cmpNum(it.produto.qtd)>0; });
  var qtdsDiferentes = todasComQtd && itens.some(function(it){ return cmpNum(it.produto.qtd)!==cmpNum(itens[0].produto.qtd); });
  var porUnidade = todasComQtd && qtdsDiferentes;
  return {
    porUnidade: porUnidade,
    label: porUnidade ? 'preço unitário líquido' : 'valor total',
    valor: function(it){ return porUnidade ? it.unitLiquido : it.total; }
  };
}

/* ---------- pontuação de custo-benefício ---------- */
function cmpComPontuacao(itens){
  if(!itens.length) return itens;
  var base = cmpBaseComparacao(itens);
  var precos = itens.map(base.valor);
  var precoMin = Math.min.apply(null, precos), precoMax = Math.max.apply(null, precos);
  var prazos = itens.map(function(it){ return cmpPrazoDias(it.fornecedor); }).filter(function(d){ return d!=null; });
  var prazoMin = prazos.length ? Math.min.apply(null, prazos) : null;
  var prazoMax = prazos.length ? Math.max.apply(null, prazos) : null;
  var pags = itens.map(function(it){ return cmpPagDias(it.fornecedor); }).filter(function(d){ return d!=null; });
  var pagMin = pags.length ? Math.min.apply(null, pags) : null;
  var pagMax = pags.length ? Math.max.apply(null, pags) : null;

  function menorMelhor(v, mn, mx){ if(v==null||mn==null||mx==null) return 50; if(mx===mn) return 100; return (mx-v)/(mx-mn)*100; }
  function maiorMelhor(v, mn, mx){ if(v==null||mn==null||mx==null) return 50; if(mx===mn) return 100; return (v-mn)/(mx-mn)*100; }

  itens.forEach(function(it){
    var st = cmpStatusEfetivo(it.fornecedor);
    var partes = {
      preco: menorMelhor(base.valor(it), precoMin, precoMax),
      prazo: menorMelhor(cmpPrazoDias(it.fornecedor), prazoMin, prazoMax),
      pagamento: maiorMelhor(cmpPagDias(it.fornecedor), pagMin, pagMax),
      homologacao: st==='homologado' ? 100 : st==='bloqueado' ? 0 : 40,
      validade: cmpPropostaVencida(it.fornecedor) ? 0 : (it.fornecedor.validadeProposta ? 100 : 55)
    };
    var soma = 0;
    CMP_PESOS.forEach(function(w){ soma += partes[w[0]] * w[2]; });
    it.score = Math.round(soma/100);
    it.scoreParts = partes;
  });
  return itens;
}
function cmpMelhorPontuado(itens){
  if(!itens.length) return null;
  return itens.slice().sort(function(a,b){
    if(b.score!==a.score) return b.score - a.score;
    return a.total - b.total;
  })[0];
}

/* ---------- economia registrada ---------- */
/* Economia de uma comparação concluída = quanto se deixou de gastar em relação à segunda
   opção mais barata (o "custo de não ter cotado"). Com uma única opção, é zero. */
function cmpEconomiaComparacao(h){
  if(!h || !h.itens || h.itens.length<2) return 0;
  var ordenados = h.itens.slice().sort(function(a,b){ return a.total-b.total; });
  var escolhido = h.itens.find(function(i){ return i.escolhido; }) || ordenados[0];
  var referencia = ordenados.find(function(i){ return i !== escolhido; });
  if(!referencia) return 0;
  return referencia.total - escolhido.total;
}
function cmpEconomiaAcumulada(){
  return STATE.comparativo.historico.reduce(function(s,h){ return s + cmpEconomiaComparacao(h); }, 0);
}

/* ---------- foto: compressão antes de guardar ----------
   O painel inteiro é republicado como um único documento HTML a cada gravação, então uma
   foto de celular em tamanho original engordaria o arquivo publicado para sempre. Toda
   imagem é reduzida e recomprimida aqui antes de virar dataURL. */
function cmpComprimirImagem(file, maxDim, quality){
  maxDim = maxDim || 900; quality = quality || 0.75;
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error('leitura')); };
    reader.onload = function(){
      var img = new Image();
      img.onload = function(){
        var w = img.naturalWidth||1, h = img.naturalHeight||1;
        var escala = Math.min(1, maxDim/Math.max(w,h));
        var cw = Math.max(1, Math.round(w*escala)), ch = Math.max(1, Math.round(h*escala));
        try {
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch(err){ reject(err); }
      };
      img.onerror = function(){ reject(new Error('decodificação')); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   Mapa Comparativo — renderização
   ============================================================ */
function renderComparativo(){
  var c = STATE.comparativo;
  cmpLimparSelecao();

  /* Aba interna válida: se a guardada sumiu, cai no primeiro fornecedor cotado. */
  var abasEspeciais = { '__comparar__':1, '__historico__':1 };
  if(UI.comparativo.aba && !abasEspeciais[UI.comparativo.aba] && !cmpFornecedorPorId(UI.comparativo.aba)){ UI.comparativo.aba = null; }
  if(!UI.comparativo.aba){ UI.comparativo.aba = c.fornecedores.length ? c.fornecedores[0].id : '__comparar__'; }

  var totalItens = c.fornecedores.reduce(function(s,f){ return s + cmpProdutosDe(f.id).length; }, 0);
  var selecionados = Object.keys(c.selecionados).length;
  var itens = cmpComPontuacao(cmpItensSelecionados());
  var economiaPotencial = itens.length>1 ? (itens[itens.length-1].total - itens[0].total) : 0;

  var kpis = ''
    + '<div class="kpi-grid" style="margin-bottom:16px">'
    + kpiTile('Propostas recebidas', num(c.fornecedores.length), num(totalItens)+' item(ns) cotado(s) no total')
    + kpiTile('No comparativo', num(selecionados), selecionados ? 'itens marcados para comparar agora' : 'marque itens na lista da aba Comparar')
    + kpiTile('Diferença entre propostas', money(economiaPotencial), itens.length>1 ? 'entre a mais cara e a mais barata selecionadas' : 'selecione 2 ou mais itens para calcular')
    + kpiTile('Comparações concluídas', num(c.historico.length), 'registradas no histórico com justificativa')
    + kpiTile('Economia registrada', money(cmpEconomiaAcumulada()), 'soma da diferença para a 2ª opção em cada decisão')
    + '</div>';

  return kpis + cmpBarraAbas() + '<div class="cmp-panel">' + cmpConteudoAba() + '</div>' + cmpModalDetalhe();
}

function cmpBarraAbas(){
  var c = STATE.comparativo;
  var html = c.fornecedores.map(function(f){
    var n = cmpProdutosDe(f.id).length;
    var ativa = UI.comparativo.aba===f.id;
    var vencida = cmpPropostaVencida(f);
    return '<button class="cmp-tab'+(ativa?' active':'')+'" data-cmp-aba="'+esc(f.id)+'" title="'+esc(cmpNomeFornecedor(f))+'">'
      + (vencida ? icon('alert') : '')
      + '<span class="cmp-tab-label">'+esc(titleCase(cmpNomeFornecedor(f)))+'</span>'
      + '<span class="count">'+n+'</span></button>';
  }).join('');

  if(UI.comparativo.novoFornecedor){
    /* Lista de sugestão com a base de fornecedores do ERP: digitar (ou escolher) um nome
       que já existe faz a proposta nascer vinculada àquele cadastro, com CNPJ, contato e
       condição de pagamento preenchidos — ver cmpCriarFornecedor(). */
    var sugestoes = '<datalist id="cmp-lista-erp">'
      + STATE.fornecedores.map(function(s){ return '<option value="'+esc(titleCase(s.nome))+'">'; }).join('')
      + '</datalist>';
    html += '<span class="cmp-add-inline" style="padding:5px 4px">'
      + sugestoes
      + '<input type="text" id="input-cmp-novo-fornecedor" list="cmp-lista-erp" placeholder="Nome do fornecedor (ou escolha um já cadastrado)" style="min-width:290px" autocomplete="off">'
      + '<button class="btn small" id="btn-cmp-confirmar-fornecedor">'+icon('check')+' Adicionar</button>'
      + '<button class="btn ghost small" id="btn-cmp-cancelar-fornecedor">'+icon('close')+'</button>'
      + '</span>';
  } else {
    html += '<button class="cmp-tab-add" id="btn-cmp-novo-fornecedor">'+icon('plus')+' Proposta</button>';
  }

  html += '<span class="cmp-tab-spacer"></span>';
  var histAtiva = UI.comparativo.aba==='__historico__';
  html += '<button class="cmp-tab special'+(histAtiva?' active':'')+'" data-cmp-aba="__historico__">'
    + icon('clock')+'<span class="cmp-tab-label">Histórico</span>'
    + (c.historico.length ? '<span class="count">'+c.historico.length+'</span>' : '')+'</button>';
  var cmpAtiva = UI.comparativo.aba==='__comparar__';
  var nSel = Object.keys(c.selecionados).length;
  html += '<button class="cmp-tab special'+(cmpAtiva?' active':'')+'" data-cmp-aba="__comparar__">'
    + icon('scale')+'<span class="cmp-tab-label">Comparar</span>'
    + (nSel ? '<span class="count">'+nSel+'</span>' : '')+'</button>';

  return '<div class="cmp-tabbar">'+html+'</div>';
}

function cmpConteudoAba(){
  if(UI.comparativo.aba==='__comparar__') return cmpAbaComparar();
  if(UI.comparativo.aba==='__historico__') return cmpAbaHistorico();
  var f = cmpFornecedorPorId(UI.comparativo.aba);
  if(!f){
    return '<div class="empty-state">'+icon('compare')
      + '<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">Nenhuma proposta cadastrada ainda</div>'
      + '<div style="max-width:430px;margin:0 auto 16px">Cadastre cada orçamento que você recebeu como uma proposta. Depois marque os itens que quer comparar e o sistema monta o mapa lado a lado, recomenda uma opção e guarda a decisão.</div>'
      + '<button class="btn" id="btn-cmp-novo-fornecedor">'+icon('plus')+' Adicionar a primeira proposta</button></div>';
  }
  return cmpAbaFornecedor(f);
}

/* ---------- aba de uma proposta ---------- */
function cmpAbaFornecedor(f){
  var produtos = cmpProdutosDe(f.id);
  var total = cmpTotalFornecedor(f.id);
  var erp = cmpFornecedorErp(f);
  var vencida = cmpPropostaVencida(f);
  var excluindo = UI.comparativo.pendingDelete === 'forn:'+f.id;

  var erpChip = erp
    ? '<div class="cmp-erp-linha"><span class="cmp-erp-chip" title="Esta proposta está vinculada ao cadastro do fornecedor">'
        + icon('factory') + '<span>Cadastro ' + esc(erp.codigo)
        + (erp.abc ? ' · classe '+esc(erp.abc) : '')
        + (erp.spend>0 ? ' · '+money(erp.spend)+' no histórico' : '')
      + '</span></span></div>'
    : '';

  var linhas = produtos.map(function(p){ return cmpLinhaProduto(f, p); }).join('');
  var linhaNovo = UI.comparativo.novoProdutoPara===f.id ? cmpLinhaNovoProduto(f) : '';

  var tabela = (produtos.length || linhaNovo)
    ? (linhaNovo ? cmpBarraCopiarItem() : '')
      + '<div class="cmp-tabela-wrap"><table class="cmp-produtos"><thead><tr>'
      + '<th class="cmp-c-foto"></th><th class="cmp-c-nome">Produto</th><th class="cmp-c-marca">Marca</th>'
      + '<th class="cmp-c-spec">Especificações</th><th class="cmp-c-un">Un.</th><th class="cmp-c-qtd">Qtd.</th>'
      + '<th class="cmp-c-preco">Valor unit.</th><th class="cmp-c-desc">Desconto</th><th class="cmp-c-frete">Frete</th>'
      + '<th class="cmp-c-moq" title="Quantidade mínima de compra exigida pelo fornecedor">MOQ</th><th class="cmp-c-imp">Impostos/Encargos</th><th class="cmp-c-total">Valor total</th>'
      + '<th class="cmp-c-acoes"></th></tr></thead><tbody>'+linhas+linhaNovo+'</tbody></table></div>'
    : '<div class="empty-state">'+icon('cube')
      + '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px">Nenhum item nesta proposta</div>'
      + '<div style="max-width:400px;margin:0 auto">Acrescente os itens que este fornecedor cotou, com foto, quantidade e valor unitário.</div></div>';

  var anexo = f.anexo
    ? '<div class="cmp-anexo-row">'
      + '<button class="cmp-anexo-link" data-cmp-baixar-anexo="'+esc(f.id)+'" title="Baixar o orçamento anexado">'+icon('file')+'<span>'+esc(f.anexo.nome||'Baixar anexo')+'</span></button>'
      + '<button class="icon-btn" data-cmp-remover-anexo="'+esc(f.id)+'" title="Remover anexo">'+icon('trash')+'</button></div>'
    : '<div class="cmp-anexo-row"><label class="btn secondary small" style="cursor:pointer">'+icon('paperclip')+' Anexar orçamento'
      + '<input type="file" accept="application/pdf,image/*" data-cmp-anexo="'+esc(f.id)+'" style="display:none"></label></div>';

  return ''
    + '<div class="cmp-head">'
    + '  <div class="cmp-field cmp-field-name" style="grid-column:span 2"><label>Fornecedor</label>'
    +      '<input type="text" data-cmp-forn-campo="nome" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.nome)+'" placeholder="Nome do fornecedor">'
    +      erpChip + '</div>'
    + '  <div class="cmp-field"><label>CNPJ</label><input type="text" data-cmp-forn-campo="cnpj" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.cnpj||'')+'" placeholder="00.000.000/0000-00"></div>'
    + '  <div class="cmp-field"><label>Status</label>'
    + (erp && getAvaliacao(erp.codigo).status==='homologado'
        ? '<div style="padding:6px 0">'+cmpStatusBadge(f)+' <span class="cell-sub">definido na ficha do fornecedor</span></div>'
        : '<select data-cmp-forn-campo="status" data-cmp-fid="'+esc(f.id)+'">'
          + '<option value="novo"'+(f.status!=='homologado'?' selected':'')+'>Novo</option>'
          + '<option value="homologado"'+(f.status==='homologado'?' selected':'')+'>Homologado</option></select>')
    + '  </div>'
    + '  <div class="cmp-field"><label>Contato</label><input type="text" data-cmp-forn-campo="contatoNome" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.contatoNome||'')+'" placeholder="Nome do vendedor"></div>'
    + '  <div class="cmp-field"><label>Telefone</label><input type="text" data-cmp-forn-campo="contatoTelefone" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.contatoTelefone||'')+'" placeholder="(00) 00000-0000"></div>'
    + '  <div class="cmp-field"><label>E-mail</label><input type="email" data-cmp-forn-campo="contatoEmail" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.contatoEmail||'')+'" placeholder="contato@fornecedor.com"></div>'
    + '  <div class="cmp-head-actions">'
    + (excluindo
        ? '<span class="cmp-confirm"><span>Excluir proposta?</span>'
          + '<button class="btn danger small" data-cmp-excluir-forn-sim="'+esc(f.id)+'">Sim, excluir</button>'
          + '<button class="btn ghost small" data-cmp-cancelar-exclusao>Cancelar</button></span>'
        : '<button class="btn ghost small" data-cmp-excluir-forn="'+esc(f.id)+'">'+icon('trash')+' Excluir proposta</button>')
    + '  </div>'
    + '</div>'
    + '<div class="cmp-meta">'
    + '  <div class="cmp-field"><label>Prazo de entrega</label><span class="cmp-combo">'
    +      '<input type="number" min="0" data-cmp-forn-campo="prazoDias" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.prazoDias==null?'':f.prazoDias)+'" placeholder="0">'
    +      '<select data-cmp-forn-campo="prazoTipo" data-cmp-fid="'+esc(f.id)+'">'
    +        '<option value="uteis"'+(f.prazoTipo!=='corridos'?' selected':'')+'>dias úteis</option>'
    +        '<option value="corridos"'+(f.prazoTipo==='corridos'?' selected':'')+'>dias corridos</option></select>'
    +    '</span></div>'
    + '  <div class="cmp-field" style="grid-column:span 2"><label>Condição de pagamento</label>'
    +      '<input type="text" data-cmp-forn-campo="pagamentoTexto" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.pagamentoTexto||'')+'" placeholder="ex.: 30 dias, ou 50% de entrada + 50% na entrega"></div>'
    + '  <div class="cmp-field"><label>Prazo de pagto. em dias</label>'
    +      '<input type="number" min="0" data-cmp-forn-campo="pagamentoDias" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.pagamentoDias==null?'':f.pagamentoDias)+'" placeholder="—"></div>'
    + '  <div class="cmp-field"><label>Validade da proposta'+(vencida?'<span class="cmp-expirada">Vencida</span>':'')+'</label>'
    +      '<input type="date" data-cmp-forn-campo="validadeProposta" data-cmp-fid="'+esc(f.id)+'" value="'+esc(f.validadeProposta||'')+'"></div>'
    + '  <div class="cmp-field"><label>Orçamento anexado</label>'+anexo+'</div>'
    + '</div>'
    + tabela
    + (UI.comparativo.novoProdutoPara===f.id
        ? '<div class="cmp-add-inline"><button class="btn" data-cmp-salvar-novo-produto="'+esc(f.id)+'">'+icon('check')+' Salvar item</button>'
          + '<button class="btn ghost" id="btn-cmp-cancelar-novo-produto">Cancelar</button>'
          + '<span class="footnote" style="margin:0">Dá para salvar apertando <kbd>Enter</kbd> em qualquer campo, e cancelar com <kbd>Esc</kbd>.</span></div>'
        : '<div style="margin-top:12px"><button class="btn" data-cmp-abrir-novo-produto="'+esc(f.id)+'">'+icon('plus')+' Adicionar item</button></div>')
    + '<div class="cmp-rodape">'
    + '  <div class="stat"><div class="lbl">Itens</div><div class="val">'+produtos.length+'</div></div>'
    + '  <div class="stat grand"><div class="lbl">Total da proposta</div><div class="val">'+moneyCents(total)+'</div></div>'
    + '</div>';
}

function cmpMiniaturaProduto(f, p){
  if(p.foto){
    return '<div class="cmp-thumb-wrap">'
      + '<button class="cmp-thumb-btn" data-cmp-ver-produto="'+esc(cmpChave(f.id,p.id))+'" title="Ver detalhes"><img src="'+p.foto+'" alt="'+esc(cmpNomeProduto(p))+'"></button>'
      + '<div class="cmp-thumb-mini">'
      +   '<label title="Trocar foto">'+icon('edit')+'<input type="file" accept="image/*" data-cmp-foto-produto="'+esc(cmpChave(f.id,p.id))+'"></label>'
      +   '<button data-cmp-remover-foto="'+esc(cmpChave(f.id,p.id))+'" title="Remover foto">'+icon('close')+'</button>'
      + '</div></div>';
  }
  return '<div class="cmp-thumb-wrap"><label class="cmp-thumb-btn empty" title="Adicionar foto">'+icon('camera')
    + '<input type="file" accept="image/*" data-cmp-foto-produto="'+esc(cmpChave(f.id,p.id))+'"></label></div>';
}

function cmpLinhaProduto(f, p){
  var chave = cmpChave(f.id, p.id);
  var excluindo = UI.comparativo.pendingDelete === 'prod:'+f.id+':'+p.id;
  var noComparativo = !!STATE.comparativo.selecionados[chave];
  var totalLinha = cmpTotalLinha(p);
  var unitLiq = cmpUnitLiquido(p);

  function campo(nome, tipo, extra){
    return '<input type="'+tipo+'" data-cmp-prod-campo="'+nome+'" data-cmp-alvo="'+esc(chave)+'" '+(extra||'')+' value="'+esc(p[nome]==null?'':p[nome])+'">';
  }

  return '<tr data-cmp-linha="'+esc(chave)+'">'
    + '<td class="cmp-c-foto">'+cmpMiniaturaProduto(f,p)+'</td>'
    + '<td class="cmp-c-nome">'+campo('nome','text','placeholder="Nome do produto"')+'</td>'
    + '<td class="cmp-c-marca">'+campo('marca','text','placeholder="Marca"')+'</td>'
    + '<td class="cmp-c-spec"><textarea data-cmp-prod-campo="spec" data-cmp-alvo="'+esc(chave)+'" rows="1" placeholder="Especificações">'+esc(p.spec||'')+'</textarea></td>'
    + '<td class="cmp-c-un"><div class="cmp-un-cell">'
    +   '<select data-cmp-unidade-select data-cmp-alvo="'+esc(chave)+'">'+cmpUnidadeOptions(p.unidade)+'</select>'
    +   '<input type="text" class="cmp-un-outro" data-cmp-unidade-outra data-cmp-alvo="'+esc(chave)+'" placeholder="digite a unidade" value="'+esc(!cmpUnidadeConhecida(p.unidade)?p.unidade:'')+'" style="display:'+(!cmpUnidadeConhecida(p.unidade)?'':'none')+'">'
    + '</div></td>'
    + '<td class="cmp-c-qtd">'+campo('qtd','number','step="any" min="0" class="cmp-num-in"')+'</td>'
    + '<td class="cmp-c-preco">'+campo('precoUnit','number','step="0.01" min="0" class="cmp-num-in"')+'</td>'
    + '<td class="cmp-c-desc">'+campo('descontoPct','number','step="0.1" min="0" max="100" class="cmp-num-in" placeholder="0%"')+'</td>'
    + '<td class="cmp-c-frete">'+campo('frete','number','step="0.01" min="0" class="cmp-num-in" placeholder="—"')+'</td>'
    + '<td class="cmp-c-moq">'+campo('moq','number','step="1" min="0" class="cmp-num-in" placeholder="—"')+'</td>'
    + '<td class="cmp-c-imp">'+campo('impostos','text','placeholder="ex.: ICMS-ST"')+'</td>'
    + '<td class="cmp-c-total cmp-total-cell" data-cmp-total-de="'+esc(chave)+'">'+moneyCents(totalLinha)
    +   '<span class="cmp-unit-liq">'+(unitLiq>0 ? moneyCents(unitLiq)+'/'+esc(p.unidade||'un') : '—')+'</span></td>'
    + '<td class="cmp-c-acoes">'
    + (excluindo
        ? '<span class="cmp-confirm"><span>Excluir?</span>'
          + '<button class="icon-btn" data-cmp-excluir-prod-sim="'+esc(chave)+'" title="Confirmar">'+icon('check')+'</button>'
          + '<button class="icon-btn" data-cmp-cancelar-exclusao title="Cancelar">'+icon('close')+'</button></span>'
        : '<span class="cmp-row-acoes">'
          + '<button class="icon-btn" data-cmp-ver-produto="'+esc(chave)+'" title="Ver detalhes">'+icon('eye')+'</button>'
          + '<button class="icon-btn'+(noComparativo?' active':'')+'" data-cmp-toggle="'+esc(chave)+'" title="'+(noComparativo?'Remover do comparativo':'Incluir no comparativo')+'">'+icon('scale')+'</button>'
          + '<button class="icon-btn" data-cmp-excluir-prod="'+esc(chave)+'" title="Excluir item">'+icon('trash')+'</button></span>')
    + '</td></tr>';
}

/* Barra acima da tabela enquanto um item novo está sendo digitado: permite copiar a
   descrição de um item já cotado em outra proposta, em vez de redigitar a mesma peça em
   cada fornecedor. Só os dados descritivos são copiados — preço, desconto e frete são
   justamente o que muda de um fornecedor para outro. */
function cmpBarraCopiarItem(){
  var opcoes = '';
  STATE.comparativo.fornecedores.forEach(function(outro){
    cmpProdutosDe(outro.id).forEach(function(p){
      opcoes += '<option value="'+esc(cmpChave(outro.id,p.id))+'">'
        + esc(titleCase(cmpNomeFornecedor(outro)))+' — '+esc(cmpNomeProduto(p))+'</option>';
    });
  });
  if(!opcoes) return '';
  return '<div class="cmp-copiar-bar">'
    + '<span>Copiar descrição de um item já cotado:</span>'
    + '<select id="select-cmp-copiar-item"><option value="">Selecione…</option>'+opcoes+'</select>'
    + '<span class="dica">preço, desconto e frete não são copiados</span>'
    + '</div>';
}

/* Linha de cadastro de um item novo. É uma linha de tabela de verdade, com uma célula por
   coluna e as mesmas classes de largura da linha normal — assim cada campo fica exatamente
   embaixo do seu cabeçalho, em vez de flutuar solto por cima da tabela. */
function cmpLinhaNovoProduto(f){
  var foto = UI.comparativo.novoProdutoFoto
    ? '<label class="cmp-thumb-btn" title="Trocar foto"><img src="'+UI.comparativo.novoProdutoFoto.dataUrl+'" alt="Foto do item"><input type="file" accept="image/*" id="input-cmp-novo-produto-foto"></label>'
    : '<label class="cmp-thumb-btn empty" title="Adicionar foto">'+icon('camera')+'<input type="file" accept="image/*" id="input-cmp-novo-produto-foto"></label>';

  return '<tr class="cmp-add-row">'
    + '<td class="cmp-c-foto"><div class="cmp-thumb-wrap">'+foto+'</div></td>'
    + '<td class="cmp-c-nome"><input type="text" id="input-cmp-np-nome" placeholder="Nome do produto"></td>'
    + '<td class="cmp-c-marca"><input type="text" id="input-cmp-np-marca" placeholder="Marca"></td>'
    + '<td class="cmp-c-spec"><input type="text" id="input-cmp-np-spec" placeholder="Especificações"></td>'
    + '<td class="cmp-c-un"><div class="cmp-un-cell">'
    +   '<select id="select-cmp-np-unidade">'+cmpUnidadeOptions('')+'</select>'
    +   '<input type="text" class="cmp-un-outro" id="input-cmp-np-unidade-outra" placeholder="digite a unidade" style="display:none">'
    + '</div></td>'
    + '<td class="cmp-c-qtd"><input type="number" step="any" min="0" class="cmp-num-in" id="input-cmp-np-qtd" placeholder="0"></td>'
    + '<td class="cmp-c-preco"><input type="number" step="0.01" min="0" class="cmp-num-in" id="input-cmp-np-preco" placeholder="0,00"></td>'
    + '<td class="cmp-c-desc"><input type="number" step="0.1" min="0" max="100" class="cmp-num-in" id="input-cmp-np-desconto" placeholder="0%"></td>'
    + '<td class="cmp-c-frete"><input type="number" step="0.01" min="0" class="cmp-num-in" id="input-cmp-np-frete" placeholder="—"></td>'
    + '<td class="cmp-c-moq"><input type="number" step="1" min="0" class="cmp-num-in" id="input-cmp-np-moq" placeholder="—"></td>'
    + '<td class="cmp-c-imp"><input type="text" id="input-cmp-np-impostos" placeholder="ex.: ICMS-ST"></td>'
    + '<td class="cmp-c-total cmp-total-cell"><span class="cmp-previa" id="cmp-np-previa">—</span></td>'
    + '<td class="cmp-c-acoes"><span class="cmp-row-acoes">'
    +   '<button class="icon-btn" data-cmp-salvar-novo-produto="'+esc(f.id)+'" title="Salvar item (Enter)">'+icon('check')+'</button>'
    +   '<button class="icon-btn" id="btn-cmp-cancelar-novo-produto" title="Cancelar (Esc)">'+icon('close')+'</button>'
    + '</span></td>'
    + '</tr>';
}

/* Mostra o valor da linha enquanto o item novo ainda está sendo digitado, na mesma coluna
   em que ele aparecerá depois de salvo. */
function cmpAtualizarPreviaNovoItem(){
  var alvo = document.getElementById('cmp-np-previa');
  if(!alvo) return;
  function v(id){ var el = document.getElementById(id); return el ? el.value : ''; }
  var selUn = document.getElementById('select-cmp-np-unidade');
  var unidade = selUn ? (selUn.value==='__outra__' ? v('input-cmp-np-unidade-outra') : selUn.value) : '';
  var provisorio = {
    qtd: cmpNum(v('input-cmp-np-qtd')), precoUnit: cmpNum(v('input-cmp-np-preco')),
    descontoPct: cmpNum(v('input-cmp-np-desconto')), frete: cmpNum(v('input-cmp-np-frete')),
    unidade: unidade
  };
  var total = cmpTotalLinha(provisorio);
  if(total<=0){ alvo.className = 'cmp-previa'; alvo.textContent = '—'; return; }
  var unit = cmpUnitLiquido(provisorio);
  alvo.className = 'cmp-previa tem-valor';
  alvo.innerHTML = moneyCents(total)
    + (unit>0 ? '<span class="cmp-unit-liq">'+moneyCents(unit)+'/'+esc(unidade||'un')+'</span>' : '');
}

/* ---------- aba Comparar ---------- */
function cmpAbaComparar(){
  var c = STATE.comparativo;
  var itens = cmpComPontuacao(cmpItensSelecionados());

  var picker = c.fornecedores.map(function(f){
    var produtos = cmpProdutosDe(f.id);
    var aberto = UI.comparativo.pickerOpen[f.id] !== false;
    var lista = produtos.length ? produtos.map(function(p){
      var marcado = !!c.selecionados[cmpChave(f.id,p.id)];
      return '<label class="cmp-picker-item">'
        + '<input type="checkbox" data-cmp-picker="'+esc(cmpChave(f.id,p.id))+'"'+(marcado?' checked':'')+'>'
        + (p.foto ? '<img class="p-thumb" src="'+p.foto+'" alt="">' : '<span class="p-thumb"></span>')
        + '<span class="p-nome">'+esc(cmpNomeProduto(p))+'</span>'
        + '<span class="p-total">'+moneyCents(cmpTotalLinha(p))+'</span></label>';
    }).join('') : '<div class="cmp-picker-vazio">Sem itens cotados</div>';
    return '<div class="cmp-picker-forn">'
      + '<div class="cmp-picker-head'+(aberto?' open':'')+'" data-cmp-picker-toggle="'+esc(f.id)+'">'
      +   '<strong>'+esc(titleCase(cmpNomeFornecedor(f)))+'</strong><span class="chev">'+icon('chevron')+'</span></div>'
      + (aberto ? '<div class="cmp-picker-list">'+lista+'</div>' : '')
      + '</div>';
  }).join('') || '<div class="cmp-picker-vazio">Cadastre propostas para poder compará-las.</div>';

  var base = cmpBaseComparacao(itens);
  var chavePadrao = itens.length ? itens[0].chave : null;
  var chaveEscolhida = (UI.comparativo.escolha && itens.some(function(it){ return it.chave===UI.comparativo.escolha; }))
    ? UI.comparativo.escolha : chavePadrao;

  var principal;
  if(!itens.length){
    principal = '<div class="empty-state">'+icon('scale')
      + '<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">Nenhum item selecionado</div>'
      + '<div style="max-width:420px;margin:0 auto">Marque os itens na lista ao lado (ou use o ícone de balança na tabela de cada proposta) para montar a comparação lado a lado. Dá para comparar quantos itens quiser, de quantos fornecedores quiser.</div></div>';
  } else {
    principal = cmpGraficoValores(itens, base) + cmpRecomendacaoHtml(itens, base) + cmpTabelaComparativa(itens, base);
  }

  var blocoEscolha = '';
  if(itens.length){
    var opcoes = itens.map(function(it){
      var rec = it.chave===chavePadrao;
      return '<option value="'+esc(it.chave)+'"'+(it.chave===chaveEscolhida?' selected':'')+'>'
        + esc(titleCase(cmpNomeFornecedor(it.fornecedor)))+' — '+esc(cmpNomeProduto(it.produto))+' ('+moneyCents(it.total)+')'
        + (rec ? ' — menor preço' : '') + '</option>';
    }).join('');
    var segueRec = chaveEscolhida===chavePadrao;
    blocoEscolha = '<div class="cmp-escolha">'
      + '<h3>Fornecedor escolhido</h3>'
      + '<div class="cmp-escolha-row">'
      +   '<select id="select-cmp-escolha">'+opcoes+'</select>'
      +   '<span class="match'+(segueRec?'':' diff')+'">'+icon(segueRec?'check':'award')
      +     (segueRec ? ' Segue a opção de menor preço' : ' Diferente da opção mais barata — registre o motivo abaixo')+'</span>'
      + '</div>'
      + '<textarea id="textarea-cmp-justificativa" placeholder="Justificativa da escolha (recomendado preencher, principalmente quando não for a proposta mais barata)">'+esc(UI.comparativo.justificativa)+'</textarea>'
      + '</div>';
  }

  var semItens = itens.length<1;
  return ''
    + '<div class="cmp-toolbar">'
    + '  <p class="cmp-hint">Selecione dois ou mais itens, de quaisquer propostas, para comparar lado a lado. Ao concluir, a comparação é registrada no histórico com o vencedor e a justificativa, e abre a versão para impressão/PDF.</p>'
    + '  <div class="cmp-acoes-topo"><div class="linha">'
    +      '<button class="btn secondary small" id="btn-cmp-exportar-csv"'+(semItens?' disabled':'')+'>'+icon('download')+' Exportar CSV</button>'
    +      '<button class="btn secondary small" id="btn-cmp-imprimir"'+(semItens?' disabled':'')+'>'+icon('printer')+' Imprimir / PDF</button>'
    +      '<button class="btn" id="btn-cmp-concluir"'+(semItens?' disabled':'')+'>'+icon('check')+' Concluir comparação</button>'
    + '  </div>'
    + (UI.comparativo.concluidoEm ? '<span class="nota">'+icon('check')+' Comparação registrada às '+esc(new Date(UI.comparativo.concluidoEm).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))+'</span>' : '')
    + '  </div>'
    + '</div>'
    + blocoEscolha
    + '<div class="cmp-layout"><div class="cmp-picker">'+picker+'</div><div>'+principal+'</div></div>';
}

function cmpGraficoValores(itens, base){
  if(!itens.length) return '';
  var valores = itens.map(base.valor);
  var maxVal = Math.max.apply(null, valores) || 1;
  var linhas = itens.map(function(it, i){
    var v = base.valor(it);
    var pct = Math.max(2, Math.round(v/maxVal*100));
    var melhor = i===0 && itens.length>1;
    return '<div class="cmp-vc-row'+(melhor?' best':'')+'">'
      + '<div class="cmp-vc-label"><span class="cmp-vc-nome"><span class="cmp-vc-forn">'+esc(titleCase(cmpNomeFornecedor(it.fornecedor)))+' — </span>'+esc(cmpNomeProduto(it.produto))+'</span>'
      + '<span class="cmp-vc-val">'+moneyCents(v)+(base.porUnidade?' /'+esc(it.produto.unidade||'un'):'')+'</span></div>'
      + '<div class="cmp-vc-track"><div class="cmp-vc-bar" style="width:'+pct+'%"></div></div></div>';
  }).join('');
  return '<div class="cmp-bloco"><h3>Valores comparados</h3>'
    + '<p class="sub">Quanto menor a barra, mais econômica a proposta. Comparação por <strong>'+base.label+'</strong>'
    + (base.porUnidade ? ' — as quantidades cotadas são diferentes, então comparar só o valor total seria enganoso.' : ', já com desconto e frete incluídos.')
    + '</p><div class="cmp-vc">'+linhas+'</div></div>';
}

/* Recomendação por menor preço — o texto e as ressalvas do sistema original. */
function cmpRecomendacaoHtml(itens, base){
  if(itens.length < 2) return '';
  var melhor = itens[0], segundo = itens[1];
  var economia = segundo.total - melhor.total;
  var economiaPct = segundo.total>0 ? (economia/segundo.total*100) : 0;

  var diasMelhor = cmpPrazoDias(melhor.fornecedor);
  var maisRapido = null;
  itens.slice(1).forEach(function(it){
    var d = cmpPrazoDias(it.fornecedor);
    if(d!=null && diasMelhor!=null && d<diasMelhor && (maisRapido==null || d<maisRapido.dias)){
      maisRapido = { dias:d, nome:cmpNomeFornecedor(it.fornecedor), prazo:cmpPrazoLabel(it.fornecedor) };
    }
  });
  var pagMelhor = cmpPagDias(melhor.fornecedor);
  var melhorPag = null;
  itens.slice(1).forEach(function(it){
    var d = cmpPagDias(it.fornecedor);
    if(d!=null && pagMelhor!=null && d>pagMelhor && (melhorPag==null || d>melhorPag.dias)){
      melhorPag = { dias:d, nome:cmpNomeFornecedor(it.fornecedor) };
    }
  });

  var frase;
  if(economia > 0.004){
    frase = 'é a opção mais econômica entre as selecionadas, por <strong>'+moneyCents(melhor.total)+'</strong> — uma economia de '
      + '<strong>'+moneyCents(economia)+'</strong> ('+economiaPct.toFixed(1).replace('.',',')+'%) em relação à próxima mais barata, '
      + esc(titleCase(cmpNomeFornecedor(segundo.fornecedor)))+' ('+moneyCents(segundo.total)+').';
  } else {
    frase = 'empata em valor total com '+esc(titleCase(cmpNomeFornecedor(segundo.fornecedor)))+', ambas por <strong>'+moneyCents(melhor.total)+'</strong>. '
      + 'Vale decidir pelo prazo de entrega ou pela condição de pagamento.';
  }

  var notas = [];
  if(maisRapido){
    notas.push('<p class="nota">Atenção: o prazo de entrega desta opção ('+esc(cmpPrazoLabel(melhor.fornecedor)||'—')+') é maior do que o de '
      + esc(titleCase(maisRapido.nome))+' ('+esc(maisRapido.prazo)+').</p>');
  } else if(diasMelhor!=null){
    notas.push('<p class="nota good">Também tem o prazo de entrega mais rápido (ou empatado) entre as opções comparadas.</p>');
  }
  if(melhorPag){
    notas.push('<p class="nota">Considere também que '+esc(titleCase(melhorPag.nome))+' oferece prazo de pagamento maior ('+melhorPag.dias+' dias) — pode compensar a diferença de preço, dependendo do fluxo de caixa.</p>');
  }
  if(cmpPropostaVencida(melhor.fornecedor)){
    notas.push('<p class="nota">Atenção: a validade da proposta de '+esc(titleCase(cmpNomeFornecedor(melhor.fornecedor)))+' está vencida ('+dateBR(melhor.fornecedor.validadeProposta)+') — reconfirme o preço com o fornecedor antes de decidir.</p>');
  }
  if(cmpStatusEfetivo(melhor.fornecedor)!=='homologado' && itens.some(function(it){ return cmpStatusEfetivo(it.fornecedor)==='homologado'; })){
    notas.push('<p class="nota">'+esc(titleCase(cmpNomeFornecedor(melhor.fornecedor)))+' ainda não é um fornecedor homologado, enquanto outra opção comparada já é.</p>');
  }
  if(base.porUnidade){
    var menorUnit = itens.slice().sort(function(a,b){ return a.unitLiquido-b.unitLiquido; })[0];
    if(menorUnit && menorUnit.chave!==melhor.chave){
      notas.push('<p class="nota">As quantidades cotadas são diferentes: por <strong>preço unitário líquido</strong> quem sai na frente é '
        + esc(titleCase(cmpNomeFornecedor(menorUnit.fornecedor)))+' ('+moneyCents(menorUnit.unitLiquido)+'/'+esc(menorUnit.produto.unidade||'un')
        + '), mesmo com valor total maior.</p>');
    }
  }

  var cardPreco = '<div class="cmp-rec"><div class="ic">'+icon('award')+'</div><div>'
    + '<h4>Recomendação por preço</h4>'
    + '<p><strong>'+esc(titleCase(cmpNomeFornecedor(melhor.fornecedor)))+' — '+esc(cmpNomeProduto(melhor.produto))+'</strong> '+frase+'</p>'
    + notas.join('') + '</div></div>';

  /* Segunda leitura: custo-benefício com pesos. Só aparece quando aponta para outra opção
     — se coincide com o menor preço, repetir a mesma indicação só faria ruído. */
  var melhorScore = cmpMelhorPontuado(itens);
  var cardScore = '';
  if(melhorScore && melhorScore.chave!==melhor.chave){
    var pesosTxt = CMP_PESOS.map(function(w){ return w[1].toLowerCase()+' '+w[2]+'%'; }).join(', ');
    var difTotal = melhorScore.total - melhor.total;
    cardScore = '<div class="cmp-rec alt"><div class="ic">'+icon('scale')+'</div><div>'
      + '<h4>Melhor custo-benefício</h4>'
      + '<p>Pelo conjunto das condições, e não só pelo preço, <strong>'+esc(titleCase(cmpNomeFornecedor(melhorScore.fornecedor)))+' — '+esc(cmpNomeProduto(melhorScore.produto))+'</strong> '
      + 'tem a melhor pontuação ('+melhorScore.score+'/100 contra '+melhor.score+'/100 da mais barata)'
      + (difTotal>0.004 ? ', apesar de custar '+moneyCents(difTotal)+' a mais' : '')+'.</p>'
      + '<p class="nota">Pontuação calculada com pesos fixos: '+esc(pesosTxt)+'. Use como segunda opinião — a decisão e a justificativa continuam sendo suas.</p>'
      + '</div></div>';
  }
  return cardPreco + cardScore;
}

function cmpTabelaComparativa(itens, base){
  var valores = itens.map(base.valor);
  var minVal = Math.min.apply(null, valores);
  var minTotal = Math.min.apply(null, itens.map(function(it){ return it.total; }));
  var minUnit = Math.min.apply(null, itens.map(function(it){ return it.unitLiquido; }));
  var maxScore = Math.max.apply(null, itens.map(function(it){ return it.score; }));
  var destacar = itens.length>1;
  var vazio = '<span class="vazio">—</span>';

  var cabecalho = '<tr><th class="rowlabel">&nbsp;</th>' + itens.map(function(it){
    var thumb = it.produto.foto
      ? '<div class="cmp-col-thumb" data-cmp-ver-produto="'+esc(it.chave)+'"><img src="'+it.produto.foto+'" alt="'+esc(cmpNomeProduto(it.produto))+'"></div>'
      : '<div class="cmp-col-thumb" data-cmp-ver-produto="'+esc(it.chave)+'">'+icon('image')+'</div>';
    return '<th class="col-head">'
      + '<button class="icon-btn cmp-remover" data-cmp-tirar="'+esc(it.chave)+'" title="Remover do comparativo">'+icon('close')+'</button>'
      + '<span class="cmp-forn-tag" title="'+esc(titleCase(cmpNomeFornecedor(it.fornecedor)))+'">'+esc(titleCase(cmpNomeFornecedor(it.fornecedor)))+'</span>'
      + thumb
      + '<div class="cmp-prod-nome" data-cmp-ver-produto="'+esc(it.chave)+'">'+esc(cmpNomeProduto(it.produto))+'</div></th>';
  }).join('') + '</tr>';

  function linha(rotulo, fn){
    return '<tr><td class="rowlabel">'+esc(rotulo)+'</td>'+itens.map(function(it){ return '<td>'+fn(it)+'</td>'; }).join('')+'</tr>';
  }
  function linhaNum(rotulo, fn, melhorSe){
    return '<tr><td class="rowlabel">'+esc(rotulo)+'</td>'+itens.map(function(it){
      var best = destacar && melhorSe && melhorSe(it);
      return '<td class="num'+(best?' best':'')+'">'+fn(it)+(best?'<span class="cmp-best-badge">melhor</span>':'')+'</td>';
    }).join('')+'</tr>';
  }

  var corpo = ''
    + linha('CNPJ', function(it){ return esc(it.fornecedor.cnpj||'') || vazio; })
    + linha('Status', function(it){
        var erp = cmpFornecedorErp(it.fornecedor);
        return cmpStatusBadge(it.fornecedor) + (erp ? '<div class="cell-sub">cadastro '+esc(erp.codigo)+(erp.abc?' · classe '+esc(erp.abc):'')+'</div>' : '');
      })
    + linha('Histórico de compras', function(it){
        var erp = cmpFornecedorErp(it.fornecedor);
        if(!erp) return '<span class="vazio">fornecedor novo</span>';
        return money(erp.spend)+'<div class="cell-sub">'+num(erp.nPedidos)+' pedido(s) no período</div>';
      })
    + linha('Contato', function(it){
        var bits = [it.fornecedor.contatoNome, it.fornecedor.contatoTelefone, it.fornecedor.contatoEmail].filter(Boolean);
        return bits.length ? esc(bits.join(' · ')) : vazio;
      })
    + linha('Prazo de entrega', function(it){ return esc(cmpPrazoLabel(it.fornecedor)) || vazio; })
    + linha('Condição de pagamento', function(it){ return esc(cmpPagLabel(it.fornecedor)) || vazio; })
    + linha('Validade da proposta', function(it){
        if(!it.fornecedor.validadeProposta) return vazio;
        return dateBR(it.fornecedor.validadeProposta) + (cmpPropostaVencida(it.fornecedor) ? '<span class="cmp-expirada">Vencida</span>' : '');
      })
    + linha('Orçamento anexado', function(it){
        var a = it.fornecedor.anexo;
        return a ? '<button class="cmp-anexo-link" data-cmp-baixar-anexo="'+esc(it.fornecedor.id||'')+'" title="Baixar o orçamento anexado">'+icon('file')+'<span>'+esc(a.nome||'Baixar anexo')+'</span></button>' : vazio;
      })
    + '<tr><td class="rowlabel">Especificações</td>'+itens.map(function(it){ return '<td class="spec-cell">'+(esc(it.produto.spec||'')||vazio)+'</td>'; }).join('')+'</tr>'
    + linha('Marca/fabricante', function(it){ return esc(it.produto.marca||'') || vazio; })
    + linha('Unidade', function(it){ return esc(it.produto.unidade||'') || vazio; })
    + linhaNum('Quantidade', function(it){ return cmpNum(it.produto.qtd).toLocaleString('pt-BR'); }, null)
    + linhaNum('Valor unitário', function(it){ return moneyCents(it.produto.precoUnit); }, null)
    + linhaNum('Desconto', function(it){ return cmpTemDesconto(it.produto) ? cmpNum(it.produto.descontoPct).toLocaleString('pt-BR')+'%' : '—'; }, null)
    + linhaNum('Frete', function(it){ return cmpTemFrete(it.produto) ? moneyCents(it.produto.frete) : '—'; }, null)
    + linhaNum('MOQ (qtd. mínima)', function(it){ return cmpNum(it.produto.moq)>0 ? cmpNum(it.produto.moq).toLocaleString('pt-BR') : '—'; }, null)
    + linha('Impostos/Encargos', function(it){ return esc(it.produto.impostos||'') || vazio; })
    + linhaNum('Preço unitário líquido', function(it){ return it.unitLiquido>0 ? moneyCents(it.unitLiquido)+'/'+esc(it.produto.unidade||'un') : '—'; },
        function(it){ return it.unitLiquido>0 && it.unitLiquido===minUnit; })
    + linhaNum('Valor total', function(it){ return moneyCents(it.total); }, function(it){ return it.total===minTotal; })
    + '<tr><td class="rowlabel">Custo-benefício</td>'+itens.map(function(it){
        var top = destacar && it.score===maxScore;
        var detalhe = CMP_PESOS.map(function(w){ return w[1]+' '+Math.round(it.scoreParts[w[0]]); }).join(' · ');
        return '<td><div class="cmp-score'+(top?' top':'')+'">'
          + '<div class="cmp-score-track"><div class="cmp-score-bar" style="width:'+Math.max(2,it.score)+'%"></div></div>'
          + '<span class="cmp-score-val">'+it.score+'</span></div>'
          + '<div class="cmp-score-detalhe">'+esc(detalhe)+'</div></td>';
      }).join('')+'</tr>';

  return '<div class="cmp-cmp-scroll"><table class="cmp-cmp"><thead>'+cabecalho+'</thead><tbody>'+corpo+'</tbody></table></div>'
    + '<div class="footnote">A comparação usa <strong>'+base.label+'</strong> como critério principal. "Custo-benefício" é uma nota de 0 a 100 que combina '
    + esc(CMP_PESOS.map(function(w){ return w[1].toLowerCase()+' ('+w[2]+'%)'; }).join(', ')) + '.</div>';
}

/* ---------- aba Histórico ---------- */
function cmpAbaHistorico(){
  var hist = STATE.comparativo.historico;
  if(!hist.length){
    return '<div class="empty-state">'+icon('clock')
      + '<div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:6px">Nenhuma comparação concluída ainda</div>'
      + '<div style="max-width:440px;margin:0 auto">Quando você concluir uma comparação na aba "Comparar", ela aparece aqui — com o vencedor, a justificativa e todos os detalhes de cada opção considerada na época, para consulta e auditoria futura.</div></div>';
  }
  var cards = hist.map(function(h){
    var aberto = !!UI.comparativo.historicoOpen[h.id];
    var d = new Date(h.criadoEm);
    var quando = isFinite(d.getTime()) ? (d.toLocaleDateString('pt-BR')+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})) : '—';
    var economia = cmpEconomiaComparacao(h);

    var cabeca = '<div class="cmp-hist-head'+(aberto?' open':'')+'" data-cmp-hist-toggle="'+esc(h.id)+'">'
      + '<div class="esq">'
      +   '<span class="data">'+esc(quando)+(h.concluidoPor?' · '+esc(h.concluidoPor):'')+'</span>'
      +   '<span class="venc">'+icon('award')+esc(titleCase(h.vencedorFornecedor||''))+' — '+esc(h.vencedorProduto||'')
      +     (h.segueMenorPreco===false ? '<span class="cmp-fora-badge">fora do menor preço</span>' : '')+'</span>'
      +   '<span class="meta">'+((h.itens||[]).length)+' opção(ões) comparada(s)'
      +     (economia>0.004 ? ' · economia de '+moneyCents(economia)+' sobre a 2ª mais barata' : '')+'</span>'
      + '</div>'
      + '<div class="dir"><span class="tot">'+moneyCents(h.vencedorTotal||0)+'</span><span class="chev">'+icon('chevron')+'</span></div></div>';

    var corpo = '';
    if(aberto){
      var linhas = (h.itens||[]).slice().sort(function(a,b){ return a.total-b.total; }).map(function(i){
        return '<tr'+(i.escolhido?' class="chosen"':'')+'>'
          + '<td>'+esc(titleCase(i.fornecedorNome||''))+(i.escolhido?'<span class="cmp-chosen-badge">escolhido</span>':'')+'</td>'
          + '<td>'+esc(i.produtoNome||'')+(i.marca?' <span class="cell-sub" style="display:inline">('+esc(i.marca)+')</span>':'')+'</td>'
          + '<td>'+esc(i.unidade||'')+'</td>'
          + '<td class="num">'+cmpNum(i.qtd).toLocaleString('pt-BR')+'</td>'
          + '<td class="num">'+moneyCents(i.precoUnit)+'</td>'
          + '<td class="num">'+(cmpNum(i.descontoPct)>0 ? cmpNum(i.descontoPct).toLocaleString('pt-BR')+'%' : '—')+'</td>'
          + '<td class="num">'+(cmpNum(i.frete)>0 ? moneyCents(i.frete) : '—')+'</td>'
          + '<td class="num">'+moneyCents(i.total)+'</td>'
          + '<td>'+esc(i.prazo||'')+'</td>'
          + '<td>'+esc(i.pagamento||'')+'</td></tr>';
      }).join('');
      corpo = '<div class="cmp-hist-body">'
        + '<div class="table-wrap"><table class="cmp-hist"><thead><tr>'
        +   '<th>Fornecedor</th><th>Produto</th><th>Un.</th><th>Qtd.</th><th>Vl. unit.</th><th>Desc.</th><th>Frete</th><th>Total</th><th>Prazo</th><th>Pagamento</th>'
        + '</tr></thead><tbody>'+linhas+'</tbody></table></div>'
        + (h.justificativa ? '<div class="cmp-hist-just"><strong>Justificativa:</strong> '+esc(h.justificativa)+'</div>' : '')
        + '<div class="cmp-hist-acoes">'
        +   '<button class="btn secondary small" data-cmp-hist-imprimir="'+esc(h.id)+'">'+icon('printer')+' Imprimir / PDF</button>'
        +   (isAdmin() ? '<button class="btn secondary small" data-cmp-hist-agendar="'+esc(h.id)+'">'+icon('kanban')+' Gerar card de compra</button>' : '')
        +   (isAdmin() ? '<button class="btn ghost small" data-cmp-hist-excluir="'+esc(h.id)+'">'+icon('trash')+' Excluir registro</button>' : '')
        + '</div></div>';
    }
    return '<div class="cmp-hist-card">'+cabeca+corpo+'</div>';
  }).join('');

  return '<p class="cmp-hint" style="margin-bottom:16px">Histórico de comparações concluídas — quem venceu, por quê, e os detalhes de cada opção considerada na época. '
    + 'Economia registrada no total: <strong>'+moneyCents(cmpEconomiaAcumulada())+'</strong>.</p>'
    + '<div class="cmp-hist-list">'+cards+'</div>';
}

/* ---------- modal de detalhe do item ---------- */
function cmpModalDetalhe(){
  var d = UI.comparativo.detalhe;
  if(!d) return '';
  var f = cmpFornecedorPorId(d.fid), p = cmpProdutoPorId(d.fid, d.pid);
  if(!f || !p){ UI.comparativo.detalhe = null; return ''; }
  var chave = cmpChave(f.id, p.id);
  var noComparativo = !!STATE.comparativo.selecionados[chave];
  var total = cmpTotalLinha(p), unit = cmpUnitLiquido(p);
  var erp = cmpFornecedorErp(f);

  function bloco(rotulo, valor, mono){
    return '<div><div class="lbl">'+esc(rotulo)+'</div><div class="v'+(mono?' mono':'')+'">'+valor+'</div></div>';
  }
  var vazio = '<span style="color:var(--ink-muted)">—</span>';

  return ''
    + '<div class="modal-backdrop" id="cmp-detalhe-backdrop">'
    + '  <div class="modal" style="max-width:680px">'
    + '    <div class="cmp-modal-foto">'
    + (p.foto ? '<img src="'+p.foto+'" alt="'+esc(cmpNomeProduto(p))+'">'
              : '<div class="ph">'+icon('image')+'<span>Sem foto cadastrada</span></div>')
    + '    </div>'
    + '    <div class="modal-body">'
    + '      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">'
    + '        <div><span class="badge badge-accent">'+esc(titleCase(cmpNomeFornecedor(f)))+(f.cnpj?' · '+esc(f.cnpj):'')+'</span>'
    + '          <h2 style="font-size:20px;margin-top:8px">'+esc(cmpNomeProduto(p))+(p.marca?' <span style="color:var(--ink-muted);font-weight:600;font-size:15px">('+esc(p.marca)+')</span>':'')+'</h2></div>'
    + '        <button class="modal-close" data-cmp-fechar-detalhe>'+icon('close')+'</button>'
    + '      </div>'
    + '      <div class="cmp-modal-grid">'
    +        bloco('Unidade', esc(p.unidade||'') || vazio)
    +        bloco('Quantidade', cmpNum(p.qtd).toLocaleString('pt-BR'), true)
    +        bloco('Valor unitário', moneyCents(p.precoUnit), true)
    +        bloco('Desconto', cmpTemDesconto(p) ? cmpNum(p.descontoPct).toLocaleString('pt-BR')+'%' : vazio, true)
    +        bloco('Frete', cmpTemFrete(p) ? moneyCents(p.frete) : vazio, true)
    +        bloco('MOQ (qtd. mínima)', cmpNum(p.moq)>0 ? cmpNum(p.moq).toLocaleString('pt-BR') : vazio, true)
    +        bloco('Valor total', moneyCents(total), true)
    +        bloco('Preço unitário líquido', unit>0 ? moneyCents(unit)+'/'+esc(p.unidade||'un') : vazio, true)
    +        bloco('Status do fornecedor', cmpStatusBadge(f))
    +        bloco('Prazo de entrega', esc(cmpPrazoLabel(f)) || vazio)
    +        bloco('Condição de pagamento', esc(cmpPagLabel(f)) || vazio)
    +        bloco('Validade da proposta', f.validadeProposta ? (dateBR(f.validadeProposta)+(cmpPropostaVencida(f)?'<span class="cmp-expirada">Vencida</span>':'')) : vazio)
    +        bloco('Contato', esc([f.contatoNome,f.contatoTelefone,f.contatoEmail].filter(Boolean).join(' · ')) || vazio)
    +        (erp ? bloco('Histórico no ERP', money(erp.spend)+' em '+num(erp.nPedidos)+' pedido(s)') : '')
    +        (p.impostos ? bloco('Impostos/Encargos', esc(p.impostos)) : '')
    + '        <div class="cmp-modal-spec"><div class="lbl">Especificações</div><div class="v">'+(esc(p.spec||'')||'Sem especificações cadastradas.')+'</div></div>'
    + '      </div>'
    + '      <div class="cmp-modal-acoes">'
    + '        <button class="btn'+(noComparativo?'':' secondary')+'" data-cmp-toggle="'+esc(chave)+'">'+icon('scale')+(noComparativo?' Remover do comparativo':' Incluir no comparativo')+'</button>'
    + '        <label class="btn secondary" style="cursor:pointer">'+icon('camera')+(p.foto?' Trocar foto':' Adicionar foto')+'<input type="file" accept="image/*" data-cmp-foto-produto="'+esc(chave)+'" style="display:none"></label>'
    + (f.anexo ? '        <button class="btn ghost" data-cmp-baixar-anexo="'+esc(f.id)+'">'+icon('file')+' Baixar orçamento anexado</button>' : '')
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   Mapa Comparativo — impressão / PDF
   ============================================================ */
function cmpTagImpressao(it, itens, chaveEscolhida){
  var maisBarato = itens.indexOf(it)===0 && itens.length>1;
  var escolhido = !!(chaveEscolhida && it.chave===chaveEscolhida);
  if(cmpPropostaVencida(it.fornecedor)) return { cor:'danger', texto:'Proposta vencida' };
  if(escolhido) return { cor:'good', texto:'Fornecedor escolhido' };
  if(maisBarato) return { cor:'accent', texto:'Menor preço' };
  if(cmpStatusEfetivo(it.fornecedor)==='homologado') return { cor:'good', texto:'Fornecedor homologado' };
  return { cor:'neutral', texto:'Fornecedor novo' };
}
function cmpNotaImpressao(it, itens, chaveEscolhida){
  var idx = itens.indexOf(it);
  var maisBarato = idx===0 && itens.length>1;
  var escolhido = !!(chaveEscolhida && it.chave===chaveEscolhida);
  var melhor = itens[0];
  var dif = it.total - melhor.total;
  var difPct = melhor.total>0 ? (dif/melhor.total*100) : 0;
  var difTxt = moneyCents(dif)+' ('+difPct.toFixed(1).replace('.',',')+'%)';

  if(cmpPropostaVencida(it.fornecedor)){
    return 'Proposta vencida em '+dateBR(it.fornecedor.validadeProposta)+' — reconfirme preço e condições com o fornecedor antes de decidir.'
      + (maisBarato ? ' Mesmo assim, seria a opção mais econômica entre as selecionadas.' : '');
  }
  if(escolhido && maisBarato) return 'Fornecedor escolhido para esta compra — e também a opção mais econômica entre as selecionadas.';
  if(escolhido) return 'Fornecedor escolhido para esta compra' + (dif>0.004 ? ', mesmo custando '+difTxt+' a mais do que a opção mais barata.' : ', com valor equivalente à opção mais barata.');
  if(maisBarato){
    if(itens.length<2) return 'Única opção selecionada nesta comparação.';
    var segundo = itens[1];
    var economia = segundo.total - it.total;
    var economiaPct = segundo.total>0 ? (economia/segundo.total*100) : 0;
    return 'Opção mais econômica entre as selecionadas — economia de '+moneyCents(economia)+' ('+economiaPct.toFixed(1).replace('.',',')+'%) em relação à próxima mais barata.';
  }
  if(cmpStatusEfetivo(it.fornecedor)==='homologado'){
    return 'Fornecedor já homologado'+(dif>0.004 ? ' — custa '+difTxt+' a mais do que a opção mais barata, mas reduz o risco de qualificação.' : '.');
  }
  return dif>0.004
    ? (difTxt+' mais caro do que a opção mais barata — avalie prazo de entrega e condição de pagamento antes de decidir.')
    : 'Valor equivalente à opção mais barata nesta comparação.';
}
function cmpCartoesImpressao(itens, chaveEscolhida){
  var cards = itens.map(function(it){
    var tag = cmpTagImpressao(it, itens, chaveEscolhida);
    var nota = cmpNotaImpressao(it, itens, chaveEscolhida);
    var vencida = cmpPropostaVencida(it.fornecedor);
    var sub = [it.produto.spec, it.produto.marca ? ('marca '+it.produto.marca) : ''].filter(Boolean).join(' · ');
    var contato = [it.fornecedor.contatoNome, it.fornecedor.contatoTelefone, it.fornecedor.contatoEmail].filter(Boolean).join(' · ');
    function esp(rotulo, valor){ return '<tr><td>'+esc(rotulo)+'</td><td>'+(valor || '—')+'</td></tr>'; }
    var especs = ''
      + esp('Unidade', esc(it.produto.unidade||''))
      + esp('Quantidade', cmpNum(it.produto.qtd).toLocaleString('pt-BR'))
      + esp('Valor unitário', moneyCents(it.produto.precoUnit))
      + (cmpTemDesconto(it.produto) ? esp('Desconto', cmpNum(it.produto.descontoPct).toLocaleString('pt-BR')+'%') : '')
      + (cmpTemFrete(it.produto) ? esp('Frete', moneyCents(it.produto.frete)) : '')
      + (it.unitLiquido>0 ? esp('Preço unit. líquido', moneyCents(it.unitLiquido)+'/'+esc(it.produto.unidade||'un')) : '')
      + (cmpNum(it.produto.moq)>0 ? esp('Qtd. mínima (MOQ)', cmpNum(it.produto.moq).toLocaleString('pt-BR')) : '')
      + (it.produto.impostos ? esp('Impostos/encargos', esc(it.produto.impostos)) : '')
      + esp('CNPJ', esc(it.fornecedor.cnpj||''))
      + (contato ? esp('Contato', esc(contato)) : '')
      + esp('Prazo de entrega', esc(cmpPrazoLabel(it.fornecedor)))
      + esp('Cond. de pagamento', esc(cmpPagLabel(it.fornecedor)))
      + esp('Validade da proposta', it.fornecedor.validadeProposta ? (dateBR(it.fornecedor.validadeProposta)+(vencida?' (vencida)':'')) : '')
      + esp('Homologação', cmpStatusLabel(it.fornecedor))
      + esp('Custo-benefício', it.score+'/100')
      + esp('Orçamento anexado', it.fornecedor.anexo ? esc(it.fornecedor.anexo.nome||'arquivo anexado') : 'Não anexado');

    return '<div class="pc-card">'
      + '<div class="pc-tag pc-tag-'+tag.cor+'">'+esc(tag.texto)+'</div>'
      + '<div class="pc-media">'+(it.produto.foto ? '<img src="'+it.produto.foto+'" alt="">' : '')+'</div>'
      + '<div class="pc-body">'
      +   '<div class="pc-title">'+esc(cmpNomeProduto(it.produto))+'</div>'
      +   (sub ? '<div class="pc-sub">'+esc(sub)+'</div>' : '')
      +   '<div class="pc-forn">'+esc(titleCase(cmpNomeFornecedor(it.fornecedor)))+'</div>'
      +   '<div class="pc-preco">'+moneyCents(it.total)+'</div>'
      +   '<table class="pc-specs">'+especs+'</table>'
      +   '<div class="pc-nota pc-nota-'+tag.cor+'">'+esc(nota)+'</div>'
      + '</div></div>';
  }).join('');
  return '<div class="pc-grid">'+cards+'</div>';
}
function cmpFolhaImpressa(itens, chaveEscolhida){
  if(!itens.length) return '';
  var base = cmpBaseComparacao(itens);
  var agora = new Date();
  var quando = agora.toLocaleDateString('pt-BR')+' às '+agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  var logo = STATE.branding.logoDataUrl ? '<img src="'+STATE.branding.logoDataUrl+'" alt="Logo">' : '';
  var usuario = currentUsuario();
  return '<div class="cmp-print-sheet">'
    + '<div class="p-head">'+logo+'<div><h1>Mapa comparativo de fornecedores</h1>'
    +   '<p>Central de Compras'+(empresaNome() ? ' · '+esc(empresaNome()) : '')+' — gerado em '+esc(quando)+(usuario?' por '+esc(usuario.nomeCompleto):'')+'</p></div></div>'
    + cmpGraficoValores(itens, base)
    + cmpRecomendacaoHtml(itens, base)
    + cmpCartoesImpressao(itens, chaveEscolhida)
    + '</div>';
}
/* Abre a folha numa janela nova e manda imprimir de lá. Quando a página está hospedada,
   ela roda dentro de um iframe com sandbox que bloqueia window.print() na própria página;
   a janela nova é um contexto separado, com permissão própria. */
function cmpImprimir(itens, chaveEscolhida){
  if(!itens.length) return;
  var popup = null;
  try { popup = window.open('', '_blank'); } catch(err){ popup = null; }
  var corpo = cmpFolhaImpressa(itens, chaveEscolhida);
  if(popup && !popup.closed){
    var doc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
      + '<title>Mapa comparativo</title>'
      + FONT_LINK_OUTER
      + '<style>' + APP_CSS_TEXT + '</style>'
      + '<style>'
      +   'html,body{margin:0;background:#fff;color:#1c1815;font-family:"Plus Jakarta Sans",system-ui,sans-serif;'
      +   '-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      +   '.folha{padding:24px;max-width:1120px;margin:0 auto}'
      +   '.acoes{display:flex;justify-content:flex-end;margin-bottom:16px}'
      +   '.acoes button{cursor:pointer;border:none;background:#ff1f3d;color:#fff;border-radius:8px;padding:10px 18px;font:600 13px inherit}'
      +   '@media print{.acoes{display:none!important}.folha{padding:0}}'
      +   '@page{size:A4 landscape;margin:12mm}'
      + '</style></head><body><div class="folha">'
      + '<div class="acoes"><button type="button" onclick="window.print()">Imprimir / salvar em PDF</button></div>'
      + corpo + '</div>'
      + '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},150);});<'+'/script>'
      + '</body></html>';
    try {
      popup.document.open(); popup.document.write(doc); popup.document.close();
      return;
    } catch(err){ /* cai no plano B abaixo */ }
  }
  toast('O navegador bloqueou a janela de impressão. Libere os pop-ups para este site e tente de novo.', true);
}
/* Reconstrói os itens de uma comparação já concluída (a partir do retrato salvo) para
   reimprimir a folha exatamente como ela era na data da decisão. */
function cmpItensDoHistorico(h){
  var itens = (h.itens||[]).map(function(i){
    var forn = {
      nome: i.fornecedorNome||'', cnpj: i.fornecedorCnpj||'', status: i.fornecedorStatus||'novo',
      codigoErp: i.fornecedorCodigoErp || '',
      contatoNome: i.contatoNome||'', contatoTelefone: i.contatoTelefone||'', contatoEmail: i.contatoEmail||'',
      prazoDias: i.prazoDias==null?'':i.prazoDias, prazoTipo: i.prazoTipo||'uteis',
      pagamentoTexto: i.pagamento||'', pagamentoDias: i.pagamentoDias==null?'':i.pagamentoDias,
      validadeProposta: i.validadeProposta||'', anexo: i.anexo||null
    };
    var prod = {
      nome: i.produtoNome||'', marca: i.marca||'', spec: i.spec||'', unidade: i.unidade||'',
      qtd: cmpNum(i.qtd), precoUnit: cmpNum(i.precoUnit), descontoPct: cmpNum(i.descontoPct),
      frete: cmpNum(i.frete), moq: cmpNum(i.moq), impostos: i.impostos||'', foto: i.foto||null
    };
    return {
      fid: 'hist', pid: i.chave||('h'+Math.random()), chave: i.chave||('h'+Math.random()),
      fornecedor: forn, produto: prod, total: cmpNum(i.total), unitLiquido: cmpUnitLiquido(prod)
    };
  }).sort(function(a,b){ return a.total-b.total; });
  cmpComPontuacao(itens);
  var escolhido = (h.itens||[]).find(function(i){ return i.escolhido; });
  return { itens: itens, chaveEscolhida: escolhido ? escolhido.chave : (itens[0] ? itens[0].chave : null) };
}

/* ---------- CSV do comparativo ---------- */
function buildCsvComparativo(){
  var itens = cmpComPontuacao(cmpItensSelecionados());
  var rows = [['Fornecedor','CNPJ','Status','Contato','Telefone','E-mail','Produto','Marca','Especificações','Unidade',
    'Quantidade','Valor unitário (R$)','Desconto (%)','Frete (R$)','MOQ','Impostos/Encargos','Valor total (R$)',
    'Preço unitário líquido (R$)','Custo-benefício (0-100)','Prazo de entrega','Condição de pagamento','Validade da proposta']];
  itens.forEach(function(it){
    rows.push([
      titleCase(cmpNomeFornecedor(it.fornecedor)), it.fornecedor.cnpj||'', cmpStatusLabel(it.fornecedor),
      it.fornecedor.contatoNome||'', it.fornecedor.contatoTelefone||'', it.fornecedor.contatoEmail||'',
      cmpNomeProduto(it.produto), it.produto.marca||'', it.produto.spec||'', it.produto.unidade||'',
      csvNum(cmpNum(it.produto.qtd)), csvNum(cmpNum(it.produto.precoUnit)), csvNum(cmpNum(it.produto.descontoPct)),
      csvNum(cmpNum(it.produto.frete)), csvNum(cmpNum(it.produto.moq)), it.produto.impostos||'',
      csvNum(it.total), csvNum(it.unitLiquido), it.score,
      cmpPrazoLabel(it.fornecedor), cmpPagLabel(it.fornecedor),
      it.fornecedor.validadeProposta ? dateBR(it.fornecedor.validadeProposta) : ''
    ]);
  });
  if(!itens.length) rows.push(['(nenhum item selecionado no Mapa comparativo)']);
  return rows.map(csvRow).join('\n');
}

/* ---------- concluir comparação ---------- */
function cmpConcluirComparacao(imprimir){
  var itens = cmpComPontuacao(cmpItensSelecionados());
  if(!itens.length){ toast('Selecione ao menos um item para comparar.', true); return; }

  var chavePadrao = itens[0].chave;
  var chaveEscolhida = (UI.comparativo.escolha && itens.some(function(it){ return it.chave===UI.comparativo.escolha; }))
    ? UI.comparativo.escolha : chavePadrao;
  var escolhido = itens.find(function(it){ return it.chave===chaveEscolhida; }) || itens[0];
  var usuario = currentUsuario();

  if(imprimir) cmpImprimir(itens, chaveEscolhida);

  var registro = {
    id: cmpGerarId('cmp'),
    criadoEm: new Date().toISOString(),
    concluidoPor: usuario ? usuario.nomeCompleto : '',
    concluidoPorUserId: usuario ? usuario.id : null,
    vencedorFornecedor: cmpNomeFornecedor(escolhido.fornecedor),
    vencedorProduto: cmpNomeProduto(escolhido.produto),
    vencedorTotal: escolhido.total,
    segueMenorPreco: chaveEscolhida===chavePadrao,
    justificativa: UI.comparativo.justificativa || '',
    baseComparacao: cmpBaseComparacao(itens).label,
    itens: itens.map(function(it){
      return {
        chave: it.chave,
        escolhido: it.chave===chaveEscolhida,
        fornecedorNome: cmpNomeFornecedor(it.fornecedor),
        fornecedorCnpj: it.fornecedor.cnpj||'',
        fornecedorStatus: cmpStatusEfetivo(it.fornecedor),
        fornecedorCodigoErp: it.fornecedor.codigoErp||'',
        contatoNome: it.fornecedor.contatoNome||'',
        contatoTelefone: it.fornecedor.contatoTelefone||'',
        contatoEmail: it.fornecedor.contatoEmail||'',
        produtoNome: cmpNomeProduto(it.produto),
        marca: it.produto.marca||'', spec: it.produto.spec||'', unidade: it.produto.unidade||'',
        qtd: cmpNum(it.produto.qtd), precoUnit: cmpNum(it.produto.precoUnit),
        descontoPct: cmpNum(it.produto.descontoPct), frete: cmpNum(it.produto.frete),
        moq: cmpNum(it.produto.moq), impostos: it.produto.impostos||'',
        total: it.total, unitLiquido: it.unitLiquido, score: it.score,
        prazo: cmpPrazoLabel(it.fornecedor), prazoDias: it.fornecedor.prazoDias==null?'':it.fornecedor.prazoDias,
        prazoTipo: it.fornecedor.prazoTipo||'uteis',
        pagamento: cmpPagLabel(it.fornecedor), pagamentoDias: it.fornecedor.pagamentoDias==null?'':it.fornecedor.pagamentoDias,
        validadeProposta: it.fornecedor.validadeProposta||'',
        foto: it.produto.foto||null,
        anexo: it.fornecedor.anexo||null
      };
    })
  };
  STATE.comparativo.historico.unshift(registro);
  var economia = cmpEconomiaComparacao(registro);
  logAtividade('Comparação de fornecedores concluída',
    registro.vencedorFornecedor+' — '+registro.vencedorProduto+' ('+moneyCents(registro.vencedorTotal)+')'
    + (economia>0.004 ? ', economia de '+moneyCents(economia) : ''));

  UI.comparativo.concluidoEm = Date.now();
  UI.comparativo.escolha = null;
  UI.comparativo.justificativa = '';
  persist('Comparação registrada no histórico.');
  render();
}

/* ---------- baixar o orçamento anexado ----------
   Com a página hospedada, ela roda num iframe com sandbox onde um <a download> (mesmo
   apontando para uma data: URL) simplesmente não faz nada para quem está vendo — ali quem
   entrega o arquivo é o serviço de download do hospedeiro, que pede confirmação antes de
   salvar. No arquivo aberto direto do disco não existe hospedeiro nenhum, e o <a download>
   comum funciona normalmente. */
function cmpDataUrlParaBlob(dataUrl){
  var partes = String(dataUrl||'').split(',');
  if(partes.length < 2) return null;
  var meta = partes[0], corpo = partes.slice(1).join(',');
  var tipo = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  try {
    if(meta.indexOf('base64') === -1){
      return new Blob([decodeURIComponent(corpo)], { type: tipo });
    }
    var bin = atob(corpo);
    var buf = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++){ buf[i] = bin.charCodeAt(i); }
    return new Blob([buf], { type: tipo });
  } catch(err){ return null; }
}
function cmpBaixarAnexo(nome, dataUrl){
  var blob = cmpDataUrlParaBlob(dataUrl);
  if(!blob){ toast('Não foi possível ler este anexo.', true); return; }
  var nomeArquivo = nome || 'orcamento';
  function planoB(){
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = nomeArquivo;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    } catch(err){ toast('Não foi possível baixar o anexo neste navegador.', true); }
  }
  if(host()){
    pedirServico('downloads').then(function(dl){
      if(!(dl && dl.save)){ planoB(); return; }
      dl.save({ filename: nomeArquivo, data: blob }).catch(function(err){
        var code = err && err.code;
        if(code === 'declined') return;
        if(code === 'rejected_extension' || code === 'extension_not_enabled'){
          toast('Este formato não pode ser baixado aqui. Anexe o orçamento em PDF ou imagem.', true); return;
        }
        planoB();
      });
    }).catch(planoB);
  } else {
    planoB();
  }
}

/* Atualiza, sem redesenhar a tela inteira, os números que dependem de um campo editado
   direto na tabela de itens. Um render() aqui roubaria o foco a cada campo preenchido e,
   pior, poderia trocar o botão que a pessoa está clicando no meio do clique. */
function cmpAtualizarTotaisNaTela(fid, chave){
  var p = cmpProdutoPorId(fid, chave.split('|')[1]);
  var celula = document.querySelector('[data-cmp-total-de="'+chave+'"]');
  if(celula && p){
    var unit = cmpUnitLiquido(p);
    celula.innerHTML = moneyCents(cmpTotalLinha(p))
      + '<span class="cmp-unit-liq">'+(unit>0 ? moneyCents(unit)+'/'+esc(p.unidade||'un') : '—')+'</span>';
  }
  var rodape = document.querySelector('.cmp-rodape .stat.grand .val');
  if(rodape) rodape.textContent = moneyCents(cmpTotalFornecedor(fid));
}

/* Gravação com atraso: preencher uma tabela dispara muitos commits seguidos, e cada
   persist() republica o documento inteiro. Sem isto, publicações concorrentes seriam
   descartadas pelo guarda de gravação e alterações se perderiam silenciosamente. */
var cmpSalvarTimer = null;
function cmpSalvarDepois(msg){
  if(cmpSalvarTimer) clearTimeout(cmpSalvarTimer);
  cmpSalvarTimer = setTimeout(function(){
    cmpSalvarTimer = null;
    if(gravando){ cmpSalvarDepois(msg); return; }
    persist(msg || 'Comparativo salvo.');
  }, 900);
}

function cmpEscolhaAtual(){
  var itens = cmpItensSelecionados();
  if(!itens.length) return null;
  var padrao = itens[0].chave;
  return (UI.comparativo.escolha && itens.some(function(it){ return it.chave===UI.comparativo.escolha; }))
    ? UI.comparativo.escolha : padrao;
}

function cmpCriarFornecedor(){
  var inp = document.getElementById('input-cmp-novo-fornecedor');
  var nome = inp ? inp.value.trim() : '';
  if(!nome){ toast('Informe o nome do fornecedor.', true); if(inp) inp.focus(); return; }

  /* Se o nome digitado bate com um fornecedor que já existe na base do ERP, a proposta
     nasce vinculada a ele e já vem com CNPJ, contato e condição de pagamento vindos da
     ficha cadastral — ninguém precisa redigitar o que a empresa já sabe, e as duas telas
     nunca passam a discordar uma da outra. */
  var alvo = normalize(nome);
  var erp = STATE.fornecedores.find(function(s){ return normalize(s.nome)===alvo; }) || null;
  var av = erp ? getAvaliacao(erp.codigo) : {};

  var novo = {
    id: cmpGerarId('cf'),
    nome: erp ? titleCase(erp.nome) : nome,
    codigoErp: erp ? erp.codigo : '',
    cnpj: av.cnpj || '',
    contatoNome: av.contatoNome || '',
    contatoTelefone: av.telefone || '',
    contatoEmail: av.email || '',
    status: av.status==='homologado' ? 'homologado' : 'novo',
    prazoDias: '', prazoTipo: 'uteis',
    pagamentoTexto: av.condicaoPagamento || '', pagamentoDias: '',
    validadeProposta: '', anexo: null,
    ordem: Date.now(),
    criadoEm: new Date().toISOString(),
    criadoPor: currentUsuario() ? currentUsuario().nomeCompleto : ''
  };
  STATE.comparativo.fornecedores.push(novo);
  STATE.comparativo.produtos[novo.id] = [];
  UI.comparativo.novoFornecedor = false;
  UI.comparativo.aba = novo.id;
  UI.comparativo.novoProdutoPara = novo.id;
  UI.comparativo.novoProdutoFoto = null;
  logAtividade('Proposta adicionada ao mapa comparativo', novo.nome + (erp ? ' (cadastro '+erp.codigo+')' : ' (fornecedor novo)'));
  persist('Proposta adicionada.');
  render();
  if(erp) toast('Cadastro de '+titleCase(erp.nome)+' preenchido a partir da aba Fornecedores.');
  var foco = document.getElementById('input-cmp-np-nome'); if(foco) foco.focus();
}

function cmpSalvarNovoProduto(fid){
  function v(id){ var el = document.getElementById(id); return el ? el.value : ''; }
  var nome = (v('input-cmp-np-nome')||'').trim();
  if(!nome){
    toast('Informe o nome do produto.', true);
    var elNome = document.getElementById('input-cmp-np-nome'); if(elNome) elNome.focus();
    return;
  }
  var selUn = document.getElementById('select-cmp-np-unidade');
  var unidade = '';
  if(selUn){ unidade = selUn.value==='__outra__' ? (v('input-cmp-np-unidade-outra')||'').trim() : selUn.value; }

  var novo = {
    id: cmpGerarId('ci'),
    nome: nome,
    marca: (v('input-cmp-np-marca')||'').trim(),
    spec: (v('input-cmp-np-spec')||'').trim(),
    unidade: unidade,
    qtd: cmpNum(v('input-cmp-np-qtd')),
    precoUnit: cmpNum(v('input-cmp-np-preco')),
    descontoPct: cmpNum(v('input-cmp-np-desconto')),
    frete: cmpNum(v('input-cmp-np-frete')),
    moq: cmpNum(v('input-cmp-np-moq')),
    impostos: (v('input-cmp-np-impostos')||'').trim(),
    foto: UI.comparativo.novoProdutoFoto ? UI.comparativo.novoProdutoFoto.dataUrl : null,
    ordem: Date.now()
  };
  (STATE.comparativo.produtos[fid] = STATE.comparativo.produtos[fid] || []).push(novo);
  UI.comparativo.novoProdutoPara = null;
  UI.comparativo.novoProdutoFoto = null;
  var fAtual = cmpFornecedorPorId(fid);
  logAtividade('Item cotado adicionado', nome + (fAtual ? ' — '+cmpNomeFornecedor(fAtual) : ''));
  persist('Item adicionado.');
  render();
}

/* ============================================================
   TAB: Pedidos de compra
   ============================================================ */
function renderPedidos(){
  var f = UI.pedidos;
  var list = STATE.pedidos.slice();
  if(f.filtro==='abertos') list = list.filter(function(p){ var st=pedidoStatus(p); return st==='aberto'||st==='recebido_parcial'; });
  else if(f.filtro==='atrasados') list = list.filter(function(p){ return pedidoStatus(p)==='atrasado'; });
  else if(f.filtro==='recebidos') list = list.filter(function(p){ return pedidoStatus(p)==='recebido_total'; });
  var visible = list.slice(0, f.limit);

  var chips = [['abertos','Em aberto'],['atrasados','Atrasados'],['recebidos','Recebidos'],['todos','Todos']].map(function(pair){
    return '<button class="chip'+(f.filtro===pair[0]?' active':'')+'" data-pedido-filtro="'+pair[0]+'">'+pair[1]+'</button>';
  }).join('');

  var totalPedidos = STATE.pedidos.length;
  var emAberto = pedidosEmAberto().length;
  var atrasados = pedidosAtrasados().length;
  var recebidosTotal = STATE.pedidos.filter(function(p){return pedidoStatus(p)==='recebido_total';}).length;

  var cardsHtml = visible.map(renderPedidoCard).join('') || '<div class="empty-state">'+icon('package')+'<div>Nenhum pedido de compra nesta lista ainda.</div></div>';

  return ''
    + '<div class="kpi-grid">'
    + kpiTile('Pedidos emitidos', num(totalPedidos), 'gerados automaticamente ao aprovar uma cotação')
    + kpiTile('Em aberto', num(emAberto), 'aguardando recebimento total')
    + kpiTile('Atrasados', num(atrasados), 'passaram do prazo previsto sem recebimento', atrasados>0)
    + kpiTile('Recebidos', num(recebidosTotal), 'recebimento total confirmado')
    + '</div>'
    + '<div class="card">'
    + '  <div class="card-head"><h2>Pedidos de compra</h2><span class="hint">emitidos automaticamente ao fechar/aprovar uma cotação — registre aqui o recebimento da mercadoria</span></div>'
    + '  <div class="toolbar"><div class="chip-row">'+chips+'</div></div>'
    + cardsHtml
    + (list.length>visible.length ? '<div style="text-align:center;margin-top:12px"><button class="btn secondary small" id="btn-pedidos-mais">Mostrar mais ('+(list.length-visible.length)+' restantes)</button></div>' : '')
    + '</div>';
}

function renderPedidoCard(p){
  var st = pedidoStatus(p);
  var recebida = qtdRecebidaPedido(p);
  var isOpen = UI.pedidos.recebimentoAbertoId === p.id;

  var recebimentosHtml = (p.recebimentos||[]).map(function(r){
    return '<div class="bar-row" style="margin-bottom:4px"><div class="label" style="width:120px">'+dateBR(r.data)+'</div><div class="bar-val" style="width:auto;flex:1;text-align:left">'+num1(r.quantidade)+' '+(p.unidade?esc(p.unidade):'un.')+(r.notaFiscal?' · NF '+esc(r.notaFiscal):'')+(r.problemaQualidade?' <span class="badge badge-crit">problema de qualidade</span>':'')+(r.anexo?' · '+icon('contract')+' '+esc(r.anexo.nome):'')+(r.obs?' — '+esc(r.obs):'')+'</div></div>';
  }).join('');

  var recebForm = '';
  if(isOpen){
    var d = UI.pedidos.recebimentoDraft;
    var restante = Math.max(0, (p.quantidade||0) - recebida);
    recebForm = '<div class="ref-price-box" style="margin-top:10px;width:100%"><div class="qform">'
      + '<div class="field"><label>Data do recebimento</label><input type="date" id="input-recebimento-data" value="'+esc(d.data||todayISO())+'"></div>'
      + '<div class="field"><label>Quantidade recebida ('+esc(p.unidade||'un.')+') — restam '+num1(restante)+'</label><input type="text" inputmode="decimal" id="input-recebimento-qtd" placeholder="Ex.: '+num1(restante)+'" value="'+esc(d.qtd||'')+'"></div>'
      + '<div class="field"><label>Nota fiscal (opcional)</label><input type="text" id="input-recebimento-nf" value="'+esc(d.notaFiscal||'')+'"></div>'
      + '<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:0"><input type="checkbox" id="chk-recebimento-problema" '+(d.problemaQualidade?'checked':'')+'> <span>Houve problema de qualidade ou divergência</span></label></div>'
      + '<div class="field"><label>Observações (opcional)</label><textarea class="obs-input" id="textarea-recebimento-obs">'+esc(d.obs||'')+'</textarea></div>'
      + '<div class="field"><label>Anexo da nota fiscal (opcional, até ~700KB)</label><input type="file" id="input-recebimento-anexo" accept="image/*,.pdf">'+(d.anexo?'<div class="footnote">Arquivo anexado: '+esc(d.anexo.nome)+'</div>':'')+'</div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'
      + '<button class="btn secondary small" id="btn-cancelar-recebimento">Cancelar</button>'
      + '<button class="btn small" data-salvar-recebimento="'+p.id+'">Salvar recebimento</button>'
      + '</div></div>';
  }

  return '<div class="alert-card" style="align-items:flex-start;flex-direction:column;gap:8px">'
    + '<div style="display:flex;justify-content:space-between;width:100%;align-items:flex-start;gap:10px">'
    + '<div><div class="alert-title">'+esc(p.numero)+' — '+(p.itemCodigo?esc(p.itemCodigo)+' — ':'')+esc(titleCase(p.itemDescricao))+'</div>'
    + '<div class="alert-meta">Fornecedor: '+esc(titleCase(p.fornecedor))+' · '+num1(p.quantidade)+' '+(p.unidade?esc(p.unidade):'un.')+' · '+money(p.valorTotal)+(p.solicitante?' · solicitado por '+esc(p.solicitante):'')+(p.setor?' ('+esc(p.setor)+')':'')+'</div></div>'
    + pedidoStatusBadge(st)
    + '</div>'
    + '<div class="footnote">Emitido em '+dateBR(p.dataEmissao.slice(0,10))+(p.dataPrevista?' · previsão de entrega '+dateBR(p.dataPrevista):' · sem prazo de entrega informado pelo fornecedor')+(recebida>0?' · recebido '+num1(recebida)+' de '+num1(p.quantidade):'')+'</div>'
    + recebimentosHtml
    + (!isOpen && st!=='recebido_total' && st!=='cancelado' ? '<div style="display:flex;gap:8px"><button class="btn ghost small" data-abrir-recebimento="'+p.id+'">Registrar recebimento</button><button class="btn ghost small" data-cancelar-pedido="'+p.id+'">Cancelar pedido</button></div>' : '')
    + recebForm
    + '</div>';
}

/* ============================================================
   TAB: Compras por período (semana / mês)
   ============================================================ */
function renderComprasPeriodo(){
  var todas = itensFechados();
  if(!todas.length){
    return '<div class="empty-state">'+icon('chart')+'<div>Ainda não há nenhuma compra fechada (item de cotação com vencedor definido).</div><div class="footnote" style="margin-top:4px">Assim que uma cotação for fechada na aba Cotações, ela aparece aqui, separada por semana e por mês.</div></div>';
  }

  var cp = UI.comprasPeriodo;
  var totalGeral = todas.reduce(function(a,x){ return a + itemValorFechado(x.item); }, 0);
  var totalItens = todas.reduce(function(a,x){ return a + (x.item.quantidade||0); }, 0);
  var fornecedoresDistintos = {};
  todas.forEach(function(x){ fornecedoresDistintos[x.item.vencedor] = true; });
  var ticketMedio = totalGeral / todas.length;

  var porMes = comprasPorMes(); // cronológico, mais antigo primeiro
  var maxMes = porMes.length ? Math.max.apply(null, porMes.map(function(m){return m.total;})) : 0;
  var resumoMensalHtml = porMes.map(function(m){
    var pct = maxMes>0 ? (m.total/maxMes*100).toFixed(1) : '0';
    return '<div class="bar-row"><div class="label">'+monthLabel(m.mes)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:var(--cat-1)"></div></div><div class="bar-val">'+money(m.total)+'</div></div>';
  }).join('');

  var topItens = topItensComprados(10);
  var topItensHtml = topItens.map(function(it){
    return '<tr><td><div class="cell-primary">'+esc(titleCase(it.descricao))+'</div><div class="cell-sub">'+it.n+' compra(s) · '+num1(it.qtd)+' un.</div></td><td class="num">'+money(it.total)+'</td></tr>';
  }).join('');

  var topFornecedores = topFornecedoresComprados(10);
  var topFornecedoresHtml = topFornecedores.map(function(f){
    return '<tr><td>'+esc(titleCase(f.nome))+'</td><td class="num">'+f.n+'</td><td class="num">'+money(f.total)+'</td></tr>';
  }).join('');

  var mesesDetalhe = porMes.slice().reverse(); // mais recente primeiro
  var mesesVisiveis = mesesDetalhe.slice(0, cp.limitMeses);
  var mesesAgrupados = comprasAgrupadas(false);
  var mesesDetalheHtml = mesesVisiveis.map(function(m){
    var g = mesesAgrupados.find(function(x){ return x.mesKey===m.mes; });
    var topItem = g ? topDeMapa(g.itens,1)[0] : null;
    var topForn = g ? topDeMapa(g.fornecedores,1)[0] : null;
    return '<div class="bar-row" style="align-items:flex-start">'
      + '<div class="label" style="width:80px">'+monthLabel(m.mes)+'</div>'
      + '<div class="bar-val" style="width:auto;flex:1;text-align:left">'
      + '<strong>'+money(m.total)+'</strong>'+(g?' · '+g.n+' compra(s)':'')
      + (topItem ? '<div class="cell-sub">Item que mais comprou: '+esc(titleCase(topItem.nome))+' ('+money(topItem.total)+')</div>' : '')
      + (topForn ? '<div class="cell-sub">Fornecedor que mais comprou: '+esc(titleCase(topForn.nome))+' ('+money(topForn.total)+')</div>' : '')
      + '</div></div>';
  }).join('');

  var semanasAgrupadas = comprasAgrupadas(true); // já ordenado mais recente primeiro
  var semanasVisiveis = semanasAgrupadas.slice(0, cp.limitSemanas);
  var semanasHtml = semanasVisiveis.map(function(g){
    var topItem = topDeMapa(g.itens,1)[0];
    var topForn = topDeMapa(g.fornecedores,1)[0];
    return '<div class="bar-row" style="align-items:flex-start">'
      + '<div class="label" style="width:220px">'+esc(g.label)+'</div>'
      + '<div class="bar-val" style="width:auto;flex:1;text-align:left">'
      + '<strong>'+money(g.total)+'</strong> · '+g.n+' compra(s)'
      + (topItem ? '<div class="cell-sub">Item que mais comprou: '+esc(titleCase(topItem.nome))+' ('+money(topItem.total)+')</div>' : '')
      + (topForn ? '<div class="cell-sub">Fornecedor que mais comprou: '+esc(titleCase(topForn.nome))+' ('+money(topForn.total)+')</div>' : '')
      + '</div></div>';
  }).join('');

  return ''
    + '<div class="kpi-grid">'
    + kpiTile('Total comprado (todas as compras fechadas)', money(totalGeral), num(todas.length)+' compra(s) fechada(s)')
    + kpiTile('Itens comprados', num1(totalItens), 'soma das quantidades de todas as compras')
    + kpiTile('Fornecedores distintos', num(Object.keys(fornecedoresDistintos).length), 'que já venceram alguma cotação')
    + kpiTile('Ticket médio por compra', money(ticketMedio), 'valor médio de cada item fechado')
    + '</div>'
    + '<div class="card" style="margin-top:16px">'
    + '  <div class="card-head"><h2>Resumo final — gasto por mês</h2><span class="hint">soma de todos os meses com compras fechadas</span></div>'
    + resumoMensalHtml
    + '  <div class="footnote" style="margin-top:10px">Total somando todos os meses: <strong>'+money(totalGeral)+'</strong></div>'
    + '</div>'
    + '<div class="grid-2" style="margin-top:16px">'
    + '  <div class="card"><div class="card-head"><h2>Itens que mais compramos</h2><span class="hint">por valor total comprado</span></div>'
    + '    <div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th class="num">Valor comprado</th></tr></thead><tbody>'+(topItensHtml||'<tr><td colspan="2">Sem dados ainda.</td></tr>')+'</tbody></table></div>'
    + '  </div>'
    + '  <div class="card"><div class="card-head"><h2>Fornecedores que mais compramos</h2><span class="hint">por valor total comprado</span></div>'
    + '    <div class="table-wrap"><table class="data"><thead><tr><th>Fornecedor</th><th class="num">Compras</th><th class="num">Valor comprado</th></tr></thead><tbody>'+(topFornecedoresHtml||'<tr><td colspan="3">Sem dados ainda.</td></tr>')+'</tbody></table></div>'
    + '  </div>'
    + '</div>'
    + '<div class="card" style="margin-top:16px">'
    + '  <div class="card-head"><h2>Compras por mês</h2><span class="hint">mais recente primeiro</span></div>'
    + mesesDetalheHtml
    + (mesesDetalhe.length>mesesVisiveis.length ? '<div style="text-align:center;margin-top:12px"><button class="btn secondary small" id="btn-compras-meses-mais">Mostrar mais</button></div>' : '')
    + '</div>'
    + '<div class="card" style="margin-top:16px">'
    + '  <div class="card-head"><h2>Compras por semana</h2><span class="hint">mais recente primeiro</span></div>'
    + semanasHtml
    + (semanasAgrupadas.length>semanasVisiveis.length ? '<div style="text-align:center;margin-top:12px"><button class="btn secondary small" id="btn-compras-semanas-mais">Mostrar mais</button></div>' : '')
    + '</div>';
}

/* ============================================================
   TAB: Reposição
   ============================================================ */
function renderReposicao(){
  var f = UI.reposicao;
  var cobertura = STATE.configReposicao.coberturaDias || 30;
  var list = filteredReposicao();
  var visible = list.slice(0, f.limit);

  var automatizados = Object.keys(STATE.pontosPedido).filter(function(k){ return STATE.pontosPedido[k] && STATE.pontosPedido[k].ativo; }).length;

  function th(key, label, numeric){
    var arrow = f.sortKey===key ? (f.sortDir==='asc'?'▲':'▼') : '';
    return '<th class="sortable'+(numeric?' num':'')+'" data-sort-reposicao="'+key+'">'+label+' <span class="sort-arrow">'+arrow+'</span></th>';
  }

  var nPrecoInvalido = list.filter(function(p){ return p.precoConfiavel===false; }).length;

  var rows = visible.map(function(p){
    var pp = STATE.pontosPedido[p.codigo] || { ativo:false };
    var qtdPonto = pontoPedidoQtd(p);
    var valorEstimado = qtdPonto * p.precoMedio;
    var valorCell = p.precoConfiavel===false
      ? '<span class="badge badge-warn" title="Preço unitário deste item varia de forma extrema entre pedidos no histórico — provável erro de cadastro ou unidade de medida trocada">revisar preço</span>'
      : money(valorEstimado);
    var estoque = getEstoque(p.codigo);
    var estoqueVal = (f.estoqueDraft && f.estoqueDraft[p.codigo]!=null) ? f.estoqueDraft[p.codigo] : (estoque ? String(estoque.qtd).replace('.',',') : '');
    var coberturaDiasReal = coberturaRestanteDias(p);
    var coberturaCell;
    if(coberturaDiasReal==null){
      coberturaCell = '<span class="footnote" style="margin:0">informe o estoque</span>';
    } else {
      var abaixo = estoque.qtd < qtdPonto;
      var critico = coberturaDiasReal < (cobertura*0.5);
      var cls = abaixo ? (critico?'badge-crit':'badge-warn') : 'badge-good';
      var txt = abaixo ? (critico?'crítico':'atenção') : 'ok';
      coberturaCell = '<span class="badge '+cls+'">'+txt+'</span> <span class="footnote" style="margin:0">'+num1(coberturaDiasReal)+' dias</span>';
    }
    return '<tr>'
      + '<td><div class="cell-primary">'+esc(titleCase(p.descricao))+'</div><div class="cell-sub">Cód. '+esc(p.codigo)+' · '+tipoLabel(p.tipo)+' · '+quadTag(p.quadrante)+'</div></td>'
      + '<td class="num">'+num(p.nPedidos)+'</td>'
      + '<td class="num">'+num1(p.consumoMedioMensal)+' '+esc(p.unidade)+'</td>'
      + '<td class="num">'+num1(qtdPonto)+' '+esc(p.unidade)+'</td>'
      + '<td class="num">'+valorCell+'</td>'
      + '<td class="num"><input type="text" inputmode="decimal" data-estoque-input="'+esc(p.codigo)+'" value="'+esc(estoqueVal)+'" placeholder="—" style="width:78px;padding:5px 7px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px;font-family:\'IBM Plex Mono\',monospace;text-align:right"></td>'
      + '<td>'+coberturaCell+'</td>'
      + '<td><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-toggle-reposicao="'+esc(p.codigo)+'" '+(pp.ativo?'checked':'')+'> <span class="footnote" style="margin:0">automática</span></label></td>'
      + '</tr>';
  }).join('');

  var quadChips = ['todos','estrategico','alavancagem','gargalo','rotina'].map(function(q){
    var label = q==='todos' ? 'Todos' : QUAD_LABELS[q];
    return '<button class="chip'+(f.quadrante===q?' active':'')+'" data-reposicao-quad="'+q+'">'+label+'</button>';
  }).join('') + '<button class="chip'+(f.abaixoPonto?' active':'')+'" data-reposicao-abaixo-ponto="1">Abaixo do ponto de pedido</button>';

  return ''
    + '<div class="kpi-grid">'
    + kpiTile('Itens com padrão de recompra', num(STATE.reposicaoCandidatos.length), '3 ou mais pedidos no período de '+Math.round(STATE.periodoDias/30.44)+' meses')
    + kpiTile('Marcados p/ reposição automática', num(automatizados), 'sinalizados pela equipe para pedido recorrente')
    + kpiTile('Cobertura desejada', cobertura+' dias', 'usada para sugerir o ponto de pedido')
    + '</div>'
    + '<div class="card" style="margin-top:16px">'
    + '  <div class="card-head"><h2>Como o ponto de pedido é calculado</h2></div>'
    + '  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
    + '    <span class="footnote" style="margin:0">Consumo médio mensal (histórico) ÷ 30,44 × dias de cobertura desejados:</span>'
    + '    <input type="text" inputmode="numeric" id="input-cobertura" value="'+cobertura+'" style="width:70px;padding:6px 9px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:\'IBM Plex Mono\',monospace">'
    + '    <span class="footnote" style="margin:0">dias</span>'
    + '    <button class="btn secondary small" id="btn-salvar-cobertura">Aplicar</button>'
    + '  </div>'
    + '  <div class="footnote" style="margin-top:8px">Esta é uma estimativa a partir do consumo histórico de pedidos. Informe o estoque atual na coluna abaixo para que o painel calcule a cobertura real em dias — isso não substitui um sistema de inventário, é uma ponte enquanto ele não existe: o valor digitado fica só neste painel e não é conferido contra o estoque físico automaticamente.'
    + (nPrecoInvalido ? ' '+num(nPrecoInvalido)+' item(ns) nesta lista têm preço unitário inconsistente no histórico (provável erro de cadastro/unidade) e por isso não mostram valor estimado — a quantidade sugerida continua válida.' : '')
    + '</div>'
    + '</div>'
    + '<div class="card">'
    + '  <div class="toolbar">'
    + '    <input type="text" class="search-input" id="input-reposicao-search" placeholder="Buscar item por nome ou código..." value="'+esc(f.search)+'">'
    + '    <div class="chip-row">'+quadChips+'</div>'
    + '  </div>'
    + '  <div class="table-wrap table-scroll"><table class="data"><thead><tr>'
    + '<th>Item</th>'+th('nPedidos','Pedidos',1)+th('consumoMedioMensal','Consumo médio/mês',1)+'<th class="num">Ponto de pedido</th><th class="num">Valor estimado</th><th class="num">Estoque atual</th><th>Cobertura real</th><th>Reposição</th>'
    + '</tr></thead><tbody>'+(rows||'<tr><td colspan="8"><div class="empty-state">'+icon('search')+'<div>Nenhum item encontrado.</div></div></td></tr>')+'</tbody></table></div>'
    + (list.length>visible.length ? '<div style="text-align:center;margin-top:12px"><button class="btn secondary small" id="btn-reposicao-mais">Mostrar mais ('+ (list.length-visible.length) +' restantes)</button></div>' : '')
    + '</div>';
}

/* ============================================================
   TAB: Contratos indexados
   ============================================================ */
function renderContratos(){
  var c = UI.contratos;
  var list = STATE.contratos.slice().sort(function(a,b){ return (a.proximoReajuste||'9999').localeCompare(b.proximoReajuste||'9999'); });
  if(c.filtro==='ativos') list = list.filter(function(x){return x.status==='ativo';});
  if(c.filtro==='atencao') list = list.filter(function(x){ var d = daysUntil(x.proximoReajuste); return x.status==='ativo' && d!=null && d<=30; });
  if(c.filtro==='encerrados') list = list.filter(function(x){return x.status==='encerrado';});

  var chips = [['todos','Todos'],['ativos','Ativos'],['atencao','Reajuste próximo'],['encerrados','Encerrados']].map(function(pair){
    return '<button class="chip'+(c.filtro===pair[0]?' active':'')+'" data-contrato-filtro="'+pair[0]+'">'+pair[1]+'</button>';
  }).join('');

  var cardsHtml = list.map(renderContratoCard).join('') || '<div class="empty-state">'+icon('contract')+'<div>Nenhum contrato nesta lista ainda.</div></div>';

  return ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Novo contrato</h2><span class="hint">registre fornecedores com preço fixo e reajuste por índice</span></div>'
    + (c.showForm ? renderContratoForm() : '<button class="btn" id="btn-abrir-contrato">'+icon('plus')+' Registrar contrato</button>')
    + '</div>'
    + '<div class="card">'
    + '  <div class="toolbar"><div class="chip-row">'+chips+'</div></div>'
    + '  ' + cardsHtml
    + '</div>';
}

function renderContratoForm(){
  var c = UI.contratos.form;
  var results = fornecedorTypeaheadResults(c.fornecedorBusca);
  var indiceOptions = Object.keys(INDICES).map(function(k){ return '<option value="'+k+'"'+(c.indice===k?' selected':'')+'>'+INDICES[k]+'</option>'; }).join('');
  var periodOptions = Object.keys(PERIODICIDADES).map(function(k){ return '<option value="'+k+'"'+(c.periodicidade===k?' selected':'')+'>'+PERIODICIDADES[k][0]+'</option>'; }).join('');

  var proximo = c.dataInicio ? addMonths(c.dataInicio, PERIODICIDADES[c.periodicidade][1]) : '';
  var obrasAtivasCt = STATE.obras.filter(function(o){return o.status==='ativa';});
  var obraOptionsCt = '<option value="">Sem obra vinculada</option>' + obrasAtivasCt.map(function(o){ return '<option value="'+esc(o.id)+'"'+(c.obraId===o.id?' selected':'')+'>'+esc(o.nome)+'</option>'; }).join('');

  return ''
    + '<div class="qform">'
    + '  <div class="field typeahead">'
    + '    <label>Fornecedor</label>'
    + '    <input type="text" id="input-contrato-fornecedor" placeholder="Digite o nome do fornecedor..." value="'+esc(c.fornecedorNome || c.fornecedorBusca)+'" autocomplete="off">'
    + (results.length && !c.fornecedorNome ? '<div class="typeahead-list">'+results.map(function(s){ return '<div class="typeahead-item" data-pick-fornecedor-contrato="'+esc(s.codigo)+'">'+esc(titleCase(s.nome))+'</div>'; }).join('')+'</div>' : '')
    + '  </div>'
    + '  <div class="field"><label>Escopo / itens cobertos</label><input type="text" id="input-contrato-escopo" placeholder="Ex.: fornecimento de perfis de aço laminado" value="'+esc(c.escopo)+'"></div>'
    + '  <div class="field"><label>Obra / centro de custo (opcional)</label><select class="filter-select" id="select-contrato-obra">'+obraOptionsCt+'</select></div>'
    + '  <div class="row3" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '    <div class="field"><label>Preço base (R$)</label><input type="text" inputmode="decimal" id="input-contrato-preco" value="'+esc(c.precoBase)+'"></div>'
    + '    <div class="field"><label>Data de início</label><input type="date" id="input-contrato-data" value="'+esc(c.dataInicio)+'"></div>'
    + '    <div class="field"><label>Índice de reajuste</label><select id="select-contrato-indice">'+indiceOptions+'</select></div>'
    + '    <div class="field"><label>Periodicidade</label><select id="select-contrato-periodicidade">'+periodOptions+'</select></div>'
    + '  </div>'
    + (proximo ? '<div class="ref-price-box">Próximo reajuste previsto: <strong>'+dateBR(proximo)+'</strong></div>' : '')
    + '  <div class="field" style="margin-top:12px"><label>Observações</label><textarea class="obs-input" id="textarea-contrato-obs" placeholder="Condições, SLA, contato do fornecedor...">'+esc(c.obs)+'</textarea></div>'
    + '  <div class="field"><label>Anexar contrato assinado (opcional, até ~700KB)</label><input type="file" id="input-contrato-anexo" accept="image/*,.pdf">'+(UI.contratos.anexoDraft?'<div class="footnote">Arquivo anexado: '+esc(UI.contratos.anexoDraft.nome)+'</div>':'')+'</div>'
    + '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'
    + '    <button class="btn secondary" id="btn-cancelar-contrato">Cancelar</button>'
    + '    <button class="btn" id="btn-salvar-contrato">Salvar contrato</button>'
    + '  </div>'
    + '</div>';
}

function renderContratoCard(ct){
  var d = daysUntil(ct.proximoReajuste);
  var statusBadgeHtml;
  if(ct.status==='encerrado') statusBadgeHtml = '<span class="badge badge-neutral">Encerrado</span>';
  else if(d!=null && d<0) statusBadgeHtml = '<span class="badge badge-crit">Reajuste atrasado</span>';
  else if(d!=null && d<=30) statusBadgeHtml = '<span class="badge badge-warn">Reajuste em '+d+' dias</span>';
  else statusBadgeHtml = '<span class="badge badge-good">Ativo</span>';

  return ''
    + '<div class="alert-card" style="align-items:flex-start;flex-direction:column;gap:6px">'
    + '  <div style="display:flex;justify-content:space-between;width:100%;align-items:flex-start">'
    + '    <div><div class="alert-title">'+esc(titleCase(ct.fornecedorNome))+'</div><div class="alert-meta">'+esc(ct.escopo)+'</div></div>'
    + '    '+statusBadgeHtml
    + '  </div>'
    + '  <div class="footnote" style="margin-top:2px">Preço base '+moneyCents(ct.precoBase)+' · índice '+INDICES[ct.indice]+' · reajuste '+PERIODICIDADES[ct.periodicidade][0].toLowerCase()+' · início '+dateBR(ct.dataInicio)+' · próximo reajuste '+dateBR(ct.proximoReajuste)+(ct.obraId && getObra(ct.obraId) ? ' · obra: '+esc(getObra(ct.obraId).nome) : '')+'</div>'
    + (ct.obs ? '<div class="footnote">Obs.: '+esc(ct.obs)+'</div>' : '')
    + (ct.anexo ? '<div class="footnote">'+icon('contract')+' Documento anexado: '+esc(ct.anexo.nome)+'</div>' : '')
    + '  <div style="display:flex;gap:8px;margin-top:6px">'
    + (ct.status!=='encerrado' ? '<button class="btn ghost small" data-renovar-contrato="'+ct.id+'">Renovar (+1 ciclo)</button><button class="btn ghost small" data-encerrar-contrato="'+ct.id+'">Encerrar</button>' : '')
    + '  </div>'
    + '</div>';
}

/* ============================================================
   TAB: Obras & centros de custo
   ============================================================ */
function renderObras(){
  var o = UI.obras;
  var list = STATE.obras.slice().sort(function(a,b){ return (b.criadoEm||'').localeCompare(a.criadoEm||''); });
  var cardsHtml = list.map(renderObraCard).join('') || '<div class="empty-state">'+icon('briefcase')+'<div>Nenhuma obra cadastrada ainda.</div></div>';

  return ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Nova obra / centro de custo</h2><span class="hint">cadastre para acompanhar o gasto de cotações e contratos por projeto</span></div>'
    + (o.showForm ? renderObraForm() : '<button class="btn" id="btn-abrir-obra">'+icon('plus')+' Cadastrar obra</button>')
    + '</div>'
    + '<div class="card">'
    + '  <div class="card-head"><h2>Obras cadastradas</h2></div>'
    + '  ' + cardsHtml
    + '  <div class="footnote">O gasto por obra é acumulado a partir de agora — cotações e contratos registrados antes de existir a obra não são retroativamente vinculados, porque o histórico do ERP não tem essa informação.</div>'
    + '</div>';
}

function renderObraForm(){
  var f = UI.obras.form;
  return ''
    + '<div class="qform">'
    + '  <div class="field"><label>Nome da obra</label><input type="text" id="input-obra-nome" placeholder="Ex.: Elevador Edifício Aurora" value="'+esc(f.nome)+'"></div>'
    + '  <div class="field"><label>Cliente (opcional)</label><input type="text" id="input-obra-cliente" placeholder="Ex.: Construtora XPTO" value="'+esc(f.cliente)+'"></div>'
    + '  <div class="field"><label>Status</label><select id="select-obra-status">'
    + '    <option value="ativa"'+(f.status==='ativa'?' selected':'')+'>Ativa</option>'
    + '    <option value="concluida"'+(f.status==='concluida'?' selected':'')+'>Concluída</option>'
    + '  </select></div>'
    + '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">'
    + '    <button class="btn secondary" id="btn-cancelar-obra">Cancelar</button>'
    + '    <button class="btn" id="btn-salvar-obra">Salvar obra</button>'
    + '  </div>'
    + '</div>';
}

function renderObraCard(ob){
  var itensAprovadosObra = obraItensAprovados(ob.id);
  var contratos = obraContratosAtivos(ob.id);
  var gasto = obraGastoTotal(ob.id);
  var statusHtml = ob.status==='concluida' ? '<span class="badge badge-neutral">Concluída</span>' : '<span class="badge badge-good">Ativa</span>';

  var itensHtml = itensAprovadosObra.slice(0,8).map(function(item){
    return '<div class="bar-row"><div class="label" title="'+esc(item.itemDescricao)+'">'+esc(titleCase(item.itemDescricao))+'</div><div class="bar-val" style="width:auto;flex:1;text-align:right">'+money(itemValorFechado(item))+'</div></div>';
  }).join('');
  var contratosHtml = contratos.map(function(c){
    return '<div class="bar-row"><div class="label" title="'+esc(c.fornecedorNome)+'">'+esc(titleCase(c.fornecedorNome))+'</div><div class="bar-val" style="width:auto;flex:1;text-align:right">'+moneyCents(c.precoBase)+' base</div></div>';
  }).join('');

  return ''
    + '<div class="alert-card" style="align-items:flex-start;flex-direction:column;gap:8px">'
    + '  <div style="display:flex;justify-content:space-between;width:100%;align-items:flex-start">'
    + '    <div><div class="alert-title">'+esc(ob.nome)+(ob.cliente?' <span class="cell-sub">('+esc(ob.cliente)+')</span>':'')+'</div><div class="alert-meta">'+num(itensAprovadosObra.length)+' item(ns) de cotação aprovado(s) · '+num(contratos.length)+' contrato(s) ativo(s) · gasto acumulado '+money(gasto)+'</div></div>'
    + '    '+statusHtml
    + '  </div>'
    + (itensHtml ? '<div style="width:100%"><div class="footnote" style="margin-bottom:4px">Cotações vinculadas:</div>'+itensHtml+'</div>' : '')
    + (contratosHtml ? '<div style="width:100%"><div class="footnote" style="margin-bottom:4px">Contratos vinculados:</div>'+contratosHtml+'</div>' : '')
    + '  <div style="display:flex;gap:8px;margin-top:4px">'
    + (ob.status!=='concluida' ? '<button class="btn ghost small" data-concluir-obra="'+ob.id+'">Marcar como concluída</button>' : '<button class="btn ghost small" data-reabrir-obra="'+ob.id+'">Reabrir</button>')
    + '  </div>'
    + '</div>';
}

/* ============================================================
   TAB: Alertas
   ============================================================ */
function renderAlertas(){
  var priceOpp = priceVariationOpportunities();
  var errors = possibleDataErrors();
  var strategic = topStrategicSingleSource();
  var pareto = paretoSuppliers();
  var contratosAtt = contratosAtencao();
  var pendAprov = itensPendentesAprovacao();

  var contratosHtml = contratosAtt.map(function(x){
    var atrasado = x.dias<0;
    return '<div class="alert-card"><div class="alert-icon '+(atrasado?'crit':'warn')+'">'+icon('contract')+'</div><div>'
      + '<div class="alert-title">'+esc(titleCase(x.c.fornecedorNome))+' — '+esc(x.c.escopo)+'</div>'
      + '<div class="alert-body">Reajuste por '+INDICES[x.c.indice]+' previsto para '+dateBR(x.c.proximoReajuste)+(atrasado?' — já vencido há '+Math.abs(x.dias)+' dias.':' — em '+x.dias+' dias.')+'</div>'
      + '</div></div>';
  }).join('') || '<div class="footnote">Nenhum contrato com reajuste próximo.</div>';

  var aprovacaoHtml = pendAprov.map(function(x){
    return '<div class="alert-card"><div class="alert-icon crit">'+icon('scale')+'</div><div>'
      + '<div class="alert-title">'+esc(itemLabel(x.item))+'</div>'
      + '<div class="alert-body">Aguardando decisão de um administrador desde '+dateBR(x.cot.criadoEm.slice(0,10))+' — escolha um dos orçamentos recebidos ou recuse a cotação.</div>'
      + '</div></div>';
  }).join('') || '<div class="footnote">Nenhuma cotação pendente de aprovação.</div>';

  var strategicHtml = strategic.map(function(p){
    var forn = p.fornecedores[0];
    var sfKey = segundaFonteKey(p);
    var sf = getSegundaFonte(p);
    var isEditingSf = UI.segundaFonte.editingId === sfKey;
    var sfEditor = '';
    if(isEditingSf){
      var dSf = UI.segundaFonte.draft;
      sfEditor = '<div class="ref-price-box" style="width:100%;margin-top:8px"><div class="qform">'
        + '<div class="field"><label>Situação da segunda fonte</label><select class="filter-select" id="select-segunda-fonte-status">'
        + ['buscando','definida','nao_aplicavel'].map(function(st){ return '<option value="'+st+'"'+(dSf.status===st?' selected':'')+'>'+segundaFonteLabel(st)+'</option>'; }).join('')
        + '</select></div>'
        + '<div class="field"><label>Fornecedor alternativo (opcional)</label><input type="text" id="input-segunda-fonte-fornecedor" value="'+esc(dSf.fornecedorAlternativo||'')+'"></div>'
        + '<div class="field"><label>Observações (opcional)</label><textarea class="obs-input" id="textarea-segunda-fonte-obs">'+esc(dSf.obs||'')+'</textarea></div>'
        + '</div>'
        + '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn secondary small" id="btn-cancelar-segunda-fonte">Cancelar</button><button class="btn small" data-salvar-segunda-fonte="'+esc(sfKey)+'">Salvar</button></div>'
        + '</div>';
    }
    return '<div class="alert-card" style="flex-direction:column;align-items:flex-start;gap:6px">'
      + '<div style="display:flex;width:100%;gap:10px;align-items:flex-start"><div class="alert-icon crit">'+icon('alert')+'</div><div style="flex:1">'
      + '<div class="alert-title">'+esc(titleCase(p.descricao))+(p.codigo?' <span class="cell-sub">(cód. '+esc(p.codigo)+')</span>':'')+'</div>'
      + '<div class="alert-body">'+money(p.spend)+' gastos com <strong>'+esc(forn?titleCase(forn.nome):'fornecedor único')+'</strong> — nenhum outro fornecedor registrado para este item.</div>'
      + '<div class="alert-meta">'+(sf ? segundaFonteBadge(sf.status)+(sf.fornecedorAlternativo?' · alternativa: '+esc(titleCase(sf.fornecedorAlternativo)):'') : 'Sugestão: buscar cotação alternativa para reduzir risco de desabastecimento.')+'</div>'
      + '</div>'
      + (!isEditingSf ? '<button class="btn ghost small" data-abrir-segunda-fonte="'+esc(sfKey)+'">'+(sf?'Editar 2ª fonte':'Registrar 2ª fonte')+'</button>' : '')
      + '</div>'
      + sfEditor
      + '</div>';
  }).join('') || '<div class="footnote">Nenhum item estratégico crítico encontrado.</div>';

  var priceHtml = priceOpp.map(function(p){
    return '<div class="alert-card"><div class="alert-icon warn">'+icon('alert')+'</div><div>'
      + '<div class="alert-title">'+esc(titleCase(p.descricao))+(p.codigo?' <span class="cell-sub">(cód. '+esc(p.codigo)+')</span>':'')+'</div>'
      + '<div class="alert-body">Preço variou de '+moneyCents(p.precoMin)+' a '+moneyCents(p.precoMax)+' entre pedidos ('+fmtPct(p.variacaoPct,0)+' de variação) em '+p.nFornecedores+' fornecedor(es) — '+p.nPedidos+' pedidos.</div>'
      + '<div class="alert-meta">Vale revisar antes da próxima compra: negociar o preço menor como referência.</div>'
      + '</div></div>';
  }).join('') || '<div class="footnote">Nenhuma variação relevante encontrada.</div>';

  var errorsHtml = errors.length ? errors.map(function(p){
    return '<div class="alert-card"><div class="alert-icon info">'+icon('alert')+'</div><div>'
      + '<div class="alert-title">'+esc(titleCase(p.descricao))+(p.codigo?' <span class="cell-sub">(cód. '+esc(p.codigo)+')</span>':'')+'</div>'
      + '<div class="alert-body">Preço unitário variou de '+moneyCents(p.precoMin)+' a '+moneyCents(p.precoMax)+' — variação acima de 1.000%, provavelmente erro de digitação ou unidade de medida trocada no pedido, não uma oportunidade real.</div>'
      + '</div></div>';
  }).join('') : '';

  var paretoHtml = pareto.slice(0,8).map(function(s){
    return '<div class="bar-row"><div class="label" title="'+esc(s.nome)+'">'+esc(titleCase(s.nome))+'</div><div class="bar-val" style="width:auto;flex:1;text-align:right">'+money(s.spend)+' · '+fmtPct(s.pct,1)+'</div></div>';
  }).join('') || '<div class="footnote">Ainda não há histórico de gasto suficiente para calcular a classe A (curva ABC).</div>';

  var mescladosHtml = STATE.fornecedoresMesclados.length ? ('<div class="alert-card"><div class="alert-icon info">'+icon('check')+'</div><div><div class="alert-title">Cadastros de fornecedor consolidados</div><div class="alert-body">'+num(STATE.fornecedoresMesclados.length)+' fornecedores que tinham cadastro duplicado no ERP (mesmo nome sob códigos diferentes) foram unificados nesta atualização do painel. Veja a lista completa na aba Fornecedores.</div></div></div>') : '';

  var semDueDiligence = fornecedoresSemDueDiligence();
  var dueDiligenceHtml = semDueDiligence.length ? semDueDiligence.slice(0,12).map(function(s){
    var av = getAvaliacao(s.codigo);
    var pendencias = [];
    if(!av.situacaoFiscal || av.situacaoFiscal==='nao_verificado') pendencias.push('situação fiscal não verificada');
    if(!av.certISO9001 && !av.certLaudo && !av.certSeguroRC) pendencias.push('nenhuma certificação registrada');
    return '<div class="alert-card"><div class="alert-icon warn">'+icon('shield')+'</div><div>'
      + '<div class="alert-title">'+esc(titleCase(s.nome))+'</div>'
      + '<div class="alert-body">Fornecedor de item(ns) estratégico(s) com fornecedor único — '+esc(pendencias.join(' · '))+'.</div>'
      + '<div class="alert-meta">Abra o cadastro na aba Fornecedores para completar a due diligence.</div>'
      + '</div></div>';
  }).join('') : '<div class="footnote">Todos os fornecedores estratégicos com fornecedor único têm due diligence registrada.</div>';

  return ''
    + (pendAprov.length ? '<div class="card"><div class="card-head"><h2>Cotações aguardando aprovação</h2><span class="hint">'+pendAprov.length+' aguardando decisão do administrador</span></div>'+aprovacaoHtml+'</div>' : '')
    + (contratosAtt.length ? '<div class="card"><div class="card-head"><h2>Contratos com reajuste próximo</h2><span class="hint">nos próximos 30 dias</span></div>'+contratosHtml+'</div>' : '')
    + '<div class="card"><div class="card-head"><h2>Itens estratégicos com fornecedor único</h2><span class="hint">maior gasto primeiro</span></div>'+strategicHtml+'</div>'
    + '<div class="card"><div class="card-head"><h2>Fornecedores estratégicos sem due diligence completa</h2><span class="hint">fornecedores de itens de fornecedor único, sem situação fiscal ou certificação registrada</span></div>'+dueDiligenceHtml+'</div>'
    + '<div class="card"><div class="card-head"><h2>Oportunidades de negociação (variação de preço)</h2><span class="hint">mesmo item pago a preços diferentes</span></div>'+priceHtml+'</div>'
    + (errorsHtml ? '<div class="card"><div class="card-head"><h2>Possíveis erros de cadastro</h2><span class="hint">variação extrema — revisar, não negociar</span></div>'+errorsHtml+'</div>' : '')
    + '<div class="card"><div class="card-head"><h2>Fornecedores prioritários para negociação</h2><span class="hint">classe A — juntos somam 80% do gasto</span></div>'+paretoHtml+(pareto.length ? '<div class="footnote">'+pareto.length+' fornecedores concentram 80% de todo o gasto do período — são os primeiros candidatos a acordos de volume, tabelas de preço fixas ou contratos indexados.</div>' : '')+'</div>'
    + (mescladosHtml ? '<div class="card"><div class="card-head"><h2>Manutenção de cadastro</h2></div>'+mescladosHtml+'</div>' : '');
}

/* ============================================================
   TAB: Atividades (trilha de auditoria)
   ============================================================ */
function renderAtividades(){
  var list = STATE.atividades.slice(0,150);
  var rows = list.map(function(a){
    var d = new Date(a.ts);
    var dataStr = isNaN(d.getTime()) ? '—' : dateBR(a.ts.slice(0,10)) + ' ' + a.ts.slice(11,16);
    return '<tr>'
      + '<td class="cell-sub" style="white-space:nowrap">'+esc(dataStr)+'</td>'
      + '<td><div class="cell-primary">'+esc(a.acao)+'</div>'+(a.detalhe?'<div class="cell-sub">'+esc(a.detalhe)+'</div>':'')+'</td>'
      + '<td>'+esc(a.autor||'Não identificado')+'</td>'
      + '</tr>';
  }).join('');

  return ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Quem fez o quê</h2><span class="hint">últimas '+num(list.length)+' ações registradas neste painel</span></div>'
    + '  <div class="footnote" style="margin-bottom:10px">Registro de ações feitas por cada usuário autenticado no painel.</div>'
    + '  <div class="table-wrap table-scroll"><table class="data"><thead><tr><th>Quando</th><th>Ação</th><th>Quem</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="3"><div class="empty-state">'+icon('clock')+'<div>Nenhuma atividade registrada ainda.</div></div></td></tr>')
    + '</tbody></table></div>'
    + '</div>';
}

/* ============================================================
   TAB: Usuários (somente administrador)
   ============================================================ */
function renderUsuarios(){
  var meId = currentUsuario() ? currentUsuario().id : null;
  var ROLE_BADGE = {
    admin: '<span class="badge badge-accent">Administrador</span>',
    chefe_setor: '<span class="badge badge-warn">Chefe de Setor</span>',
    operador: '<span class="badge badge-neutral">Operador</span>'
  };
  var ROLE_BTN_LABEL = { admin:'Tornar administrador', operador:'Tornar operador', chefe_setor:'Tornar chefe de setor' };

  var todosUsuarios = STATE.usuarios;
  var pendentes = todosUsuarios.filter(function(u){ return usuarioStatus(u)==='pendente'; })
    .sort(function(a,b){ return (a.criadoEm||'').localeCompare(b.criadoEm||''); });
  var recusados = todosUsuarios.filter(function(u){ return usuarioStatus(u)==='recusado'; })
    .sort(function(a,b){ return (b.criadoEm||'').localeCompare(a.criadoEm||''); });
  var aprovados = todosUsuarios.filter(function(u){ return usuarioStatus(u)==='aprovado'; });

  /* --- Cadastros pendentes: o administrador vê quem pediu acesso, confere/corrige o
     tipo de conta (Operador x Chefe de Setor) e aprova ou recusa. --- */
  var pendOverride = UI.usuarios.pendingRoleOverride || {};
  var pendentesHtml = pendentes.map(function(u){
    var papelSel = pendOverride[u.id] || u.papel;
    if(papelSel!=='chefe_setor') papelSel = 'operador';
    return '<div class="card pending-user-card" data-pending-user-card="'+u.id+'" style="background:var(--surface-2);box-shadow:none;margin-bottom:12px">'
      + '  <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">'
      + '    <div><div class="cell-primary">'+esc(u.nomeCompleto)+'</div><div class="cell-sub">'+esc(u.email)+(u.ramal?' · ramal '+esc(u.ramal):'')+'</div></div>'
      + '    <div class="cell-sub">Solicitado em '+dateBR((u.criadoEm||'').slice(0,10))+'</div>'
      + '  </div>'
      + '  <div class="field" style="margin:12px 0 4px">'
      + '    <label>Pediu para entrar como '+(u.papel==='chefe_setor'?'Chefe de Setor':'Operador')+' — confirme ou corrija o tipo de conta antes de aprovar</label>'
      + '    <div class="chip-row">'
      + '      <button type="button" class="chip'+(papelSel!=='chefe_setor'?' active':'')+'" data-pending-role="'+u.id+'" data-role="operador">Operador</button>'
      + '      <button type="button" class="chip'+(papelSel==='chefe_setor'?' active':'')+'" data-pending-role="'+u.id+'" data-role="chefe_setor">Chefe de Setor</button>'
      + '    </div>'
      + '  </div>'
      + '  <div style="display:flex;gap:8px;margin-top:10px">'
      + '    <button class="btn small" data-aprovar-usuario="'+u.id+'">'+icon('check')+' Aprovar como '+(papelSel==='chefe_setor'?'Chefe de Setor':'Operador')+'</button>'
      + '    <button class="btn danger small" data-recusar-usuario="'+u.id+'">'+icon('close')+' Recusar</button>'
      + '  </div>'
      + '</div>';
  }).join('');

  var pendentesSection = ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Cadastros pendentes</h2>'
    + (pendentes.length ? '<span class="badge badge-warn">'+num(pendentes.length)+' aguardando aprovação</span>' : '<span class="hint">Nenhum no momento</span>')
    + '  </div>'
    + (pendentes.length
        ? '  <div class="footnote" style="margin-bottom:10px">Confira quem está pedindo acesso e corrija o tipo de conta se a pessoa marcou o setor errado — quem vira Chefe de Setor só enxerga a aba Hora Extra depois de aprovado.</div>' + pendentesHtml
        : '  <div class="empty-state">'+icon('shield')+'<div>Nenhum cadastro aguardando aprovação.</div></div>')
    + '</div>';

  /* --- Tabela de usuários aprovados (comportamento existente, agora só com quem está
     com status 'aprovado' — pendentes e recusados vivem nas seções próprias acima/abaixo). --- */
  var rows = aprovados.slice().sort(function(a,b){ return a.nomeCompleto.localeCompare(b.nomeCompleto); }).map(function(u){
    var isSelf = meId===u.id;
    var isLastAdmin = u.papel==='admin' && contarAdmins()<=1;
    var roleBtns = ['admin','operador','chefe_setor'].filter(function(r){ return r!==u.papel; }).map(function(r){
      var blocked = isLastAdmin; /* tirar o papel de admin do único admin restante nunca é permitido */
      return '<button class="btn ghost small" data-definir-papel-usuario="'+u.id+'" data-novo-papel="'+r+'"'+(blocked?' disabled title="Precisa haver ao menos um administrador"':'')+'>'+ROLE_BTN_LABEL[r]+'</button>';
    }).join(' ');
    return '<tr>'
      + '<td><div class="cell-primary">'+esc(u.nomeCompleto)+(isSelf?' <span class="cell-sub">(você)</span>':'')+'</div><div class="cell-sub">'+esc(u.email)+'</div></td>'
      + '<td>'+esc(u.ramal||'—')+'</td>'
      + '<td>'+(ROLE_BADGE[u.papel]||ROLE_BADGE.operador)+'</td>'
      + '<td class="cell-sub">'+dateBR((u.criadoEm||'').slice(0,10))+'</td>'
      + '<td style="white-space:nowrap">'
      + roleBtns + ' '
      + '<button class="icon-btn" data-remover-usuario="'+u.id+'" title="Remover"'+(isSelf||isLastAdmin?' disabled':'')+'>'+icon('trash')+'</button>'
      + '</td>'
      + '</tr>'
      + '<tr><td colspan="5" style="border-bottom:1px solid var(--border-strong)"><div style="display:flex;gap:8px;align-items:center;margin:-4px 0 8px"><input type="password" placeholder="Nova senha temporária (mín. 6 caracteres)" id="input-reset-senha-'+u.id+'" style="flex:1;max-width:280px;padding:6px 9px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:12.5px"><button class="btn secondary small" data-redefinir-senha-usuario="'+u.id+'">Redefinir senha</button></div></td></tr>';
  }).join('');

  var aprovadosSection = ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Usuários do painel</h2><span class="hint">'+num(aprovados.length)+' cadastro(s) aprovado(s)</span></div>'
    + '  <div class="footnote" style="margin-bottom:10px">Somente administradores podem aceitar um dos orçamentos ou recusar uma cotação, na aba Cotações. Operadores têm acesso a todo o restante do painel (exceto esta aba). Chefe de Setor só tem acesso à aba Hora Extra.</div>'
    + '  <div class="table-wrap"><table class="data"><thead><tr><th>Nome / e-mail</th><th>Ramal</th><th>Papel</th><th>Cadastrado em</th><th></th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="5"><div class="empty-state">'+icon('user')+'<div>Nenhum usuário aprovado ainda.</div></div></td></tr>')
    + '</tbody></table></div>'
    + '</div>';

  /* --- Recusados: lista secundária e recolhida (details/summary nativos), com opção de
     excluir em definitivo ou devolver a pessoa para a fila de pendentes por engano. --- */
  var recusadosSection = '';
  if(recusados.length){
    var recusadosRows = recusados.map(function(u){
      return '<tr>'
        + '<td><div class="cell-primary">'+esc(u.nomeCompleto)+'</div><div class="cell-sub">'+esc(u.email)+(u.ramal?' · ramal '+esc(u.ramal):'')+'</div></td>'
        + '<td class="cell-sub">'+dateBR((u.criadoEm||'').slice(0,10))+'</td>'
        + '<td style="white-space:nowrap">'
        + '<button class="btn ghost small" data-reconsiderar-usuario="'+u.id+'">Voltar para pendente</button> '
        + '<button class="icon-btn" data-excluir-recusado="'+u.id+'" title="Excluir definitivamente">'+icon('trash')+'</button>'
        + '</td></tr>';
    }).join('');
    recusadosSection = ''
      + '<div class="card">'
      + '  <details>'
      + '    <summary style="cursor:pointer;font-weight:700;font-size:15px;color:var(--ink)">Recusados <span class="badge badge-neutral" style="margin-left:6px">'+num(recusados.length)+'</span></summary>'
      + '    <div class="footnote" style="margin:10px 0">Cadastros recusados não conseguem entrar no painel. Se foi engano, devolva para a fila de pendentes; senão, pode excluir em definitivo.</div>'
      + '    <div class="table-wrap"><table class="data"><thead><tr><th>Nome / e-mail</th><th>Cadastrado em</th><th></th></tr></thead><tbody>'+recusadosRows+'</tbody></table></div>'
      + '  </details>'
      + '</div>';
  }

  return pendentesSection
    + aprovadosSection
    + recusadosSection
    + '<div class="card">'
    + '  <div class="card-head"><h2>Identificação da empresa</h2><span class="hint">aparece na tela de login, no mapa comparativo e nos relatórios impressos</span></div>'
    + '  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '    <input type="text" id="input-empresa-nome" placeholder="Nome da empresa" value="'+esc(empresaNome())+'" style="flex:1;min-width:220px;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:13px">'
    + '    <button class="btn secondary small" id="btn-salvar-empresa-nome">Salvar</button>'
    + '  </div>'
    + '</div>'
    + '<div class="card">'
    + '  <div class="card-head"><h2>Código de cadastro de administrador</h2><span class="hint">quem souber este código vira administrador ao se cadastrar</span></div>'
    + '  <div class="footnote" style="margin-bottom:10px">Por segurança, o código atual não é exibido aqui. Defina um novo código para compartilhar com quem deve virar administrador.</div>'
    + '  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '    <input type="text" id="input-novo-codigo-admin" placeholder="Novo código de administrador" value="'+esc(UI.usuarios.novoCodigoAdmin)+'" style="flex:1;min-width:220px;padding:8px 10px;border-radius:7px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--ink);font-size:13px">'
    + '    <button class="btn secondary small" id="btn-salvar-codigo-admin">Salvar novo código</button>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   TAB: Agendamento de Compras (Kanban)
   ============================================================ */
var AGENDAMENTO_COLUNAS = [
  { status:'pendente', label:'Pendente' },
  { status:'comprando', label:'Comprando' },
  { status:'comprado', label:'Comprado' }
];
function operadoresDisponiveis(){ return STATE.usuarios.filter(function(u){ return u.papel==='operador' && usuarioStatus(u)==='aprovado'; }).sort(function(a,b){ return a.nomeCompleto.localeCompare(b.nomeCompleto); }); }

function renderAgendamento(){
  var cards = STATE.agendamentos.slice().sort(function(a,b){ return (b.criadoEm||'').localeCompare(a.criadoEm||''); });
  var colsHtml = AGENDAMENTO_COLUNAS.map(function(col){
    var colCards = cards.filter(function(c){ return c.status===col.status; });
    var cardsHtml = colCards.map(renderAgendamentoCard).join('') || '<div class="empty-state" style="padding:22px 10px">'+icon('kanban')+'<div>Nenhum card aqui.</div></div>';
    return '<div class="kanban-col">'
      + '  <div class="kanban-col-head"><span>'+col.label+'</span><span class="nav-badge" style="background:var(--surface-sunken);color:var(--ink-2)">'+colCards.length+'</span></div>'
      + '  <div class="kanban-col-body">'+cardsHtml+'</div>'
      + '</div>';
  }).join('');

  return ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Quadro de compras</h2><span class="hint">'+num(cards.length)+' card(s) no total</span></div>'
    + (isAdmin()
        ? '<button class="btn" id="btn-novo-agendamento">'+icon('plus')+' Novo card</button>'
        : '<div class="footnote">Somente um administrador pode criar ou reatribuir um card. Você pode avançar o status dos cards atribuídos a você.</div>')
    + '</div>'
    + '<div class="kanban-board">' + colsHtml + '</div>'
    + (UI.agendamento.showForm ? renderAgendamentoModal() : '');
}

function renderAgendamentoCard(c){
  var me = currentUsuario();
  var souResponsavel = me && c.responsavelUserId===me.id;
  var podeAgir = isAdmin() || souResponsavel;
  var expandido = !!UI.agendamento.expandedIds[c.id];
  var explicacaoCurta = c.explicacao && c.explicacao.length>90 && !expandido ? c.explicacao.slice(0,90)+'…' : c.explicacao;
  var isPendingDelete = UI.agendamento.pendingDeleteId===c.id;

  var fotoHtml = c.foto ? '<img class="kanban-card-photo" src="'+c.foto+'" alt="Foto do produto">' : '';

  var acoesHtml = '';
  if(!isPendingDelete){
    var botoes = [];
    if(c.status==='pendente' && podeAgir) botoes.push('<button class="btn small" data-agendamento-id="'+c.id+'" data-agendamento-set-status="comprando">Iniciar compra</button>');
    if(c.status==='comprando' && podeAgir) botoes.push('<button class="btn small" data-agendamento-id="'+c.id+'" data-agendamento-set-status="comprado">Marcar como comprado</button>');
    if(isAdmin() && c.status==='comprando') botoes.push('<button class="btn ghost small" data-agendamento-id="'+c.id+'" data-agendamento-set-status="pendente">Voltar p/ pendente</button>');
    if(isAdmin() && c.status==='comprado') botoes.push('<button class="btn ghost small" data-agendamento-id="'+c.id+'" data-agendamento-set-status="comprando">Reabrir</button>');
    if(isAdmin()) botoes.push('<button class="icon-btn" data-editar-agendamento="'+c.id+'" title="Editar">'+icon('edit')+'</button>');
    if(isAdmin()) botoes.push('<button class="icon-btn" data-excluir-agendamento="'+c.id+'" title="Excluir">'+icon('trash')+'</button>');
    acoesHtml = '<div class="kanban-card-actions">'+botoes.join('')+'</div>';
  } else {
    acoesHtml = '<div class="kanban-card-actions"><span class="footnote" style="margin:0">Excluir este card?</span> <button class="btn danger small" data-confirmar-excluir-agendamento="'+c.id+'">Sim, excluir</button> <button class="btn ghost small" data-cancelar-excluir-agendamento="'+c.id+'">Cancelar</button></div>';
  }

  return ''
    + '<div class="kanban-card">'
    + fotoHtml
    + '<div class="kanban-card-title">'+esc(titleCase(c.produto))+'</div>'
    + '<div class="kanban-card-meta">'+num1(c.quantidade||0)+' '+esc(c.unidade||'un')+(c.fornecedor?' <span class="badge badge-neutral">'+esc(titleCase(c.fornecedor))+'</span>':'')+'</div>'
    + '<div class="kanban-card-meta"><strong>Responsável:</strong> '+esc(c.responsavelNome||'—')+'</div>'
    + (c.explicacao ? '<div class="kanban-card-explicacao">'+esc(explicacaoCurta)+(c.explicacao.length>90 ? ' <button class="link-btn" data-toggle-explicacao-agendamento="'+c.id+'">'+(expandido?'ver menos':'ver mais')+'</button>' : '')+'</div>' : '')
    + (c.status==='comprado' && c.concluidoEm ? '<div class="cell-sub" style="margin-top:4px">Concluído em '+dateBR(c.concluidoEm.slice(0,10))+'</div>' : '')
    + acoesHtml
    + '</div>';
}

function renderAgendamentoModal(){
  var f = UI.agendamento.form;
  var editando = !!UI.agendamento.editingId;
  var operadores = operadoresDisponiveis();
  var operadoresOptions = '<option value="">Selecione um operador...</option>' + operadores.map(function(u){
    return '<option value="'+u.id+'"'+(f.responsavelUserId===u.id?' selected':'')+'>'+esc(u.nomeCompleto)+'</option>';
  }).join('');
  var fotoPreview = f.foto
    ? '<div style="margin-top:6px"><img src="'+f.foto+'" alt="Foto" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid var(--border-strong)"> <button class="link-btn" data-clear-agendamento-foto>remover foto</button></div>'
    : '';

  return ''
    + '<div class="modal-backdrop" id="agendamento-modal-backdrop">'
    + '  <div class="modal">'
    + '    <div class="modal-head"><h2 style="font-size:17px">'+(editando?'Editar card':'Novo card de compra')+'</h2><button class="modal-close" data-close-agendamento>'+icon('close')+'</button></div>'
    + '    <div class="modal-body">'
    + '      <div class="qform">'
    + '        <div class="field"><label>Foto do produto (opcional)</label><input type="file" accept="image/*" data-agendamento-foto>'+fotoPreview+'</div>'
    + '        <div class="field"><label>Produto</label><input type="text" id="input-agendamento-produto" placeholder="Ex.: Luva de raspa tamanho G" value="'+esc(f.produto)+'"></div>'
    + '        <div class="field" style="display:grid;grid-template-columns:2fr 1fr;gap:10px">'
    + '          <div><label>Quantidade</label><input type="text" inputmode="decimal" id="input-agendamento-quantidade" placeholder="Ex.: 10" value="'+esc(f.quantidade)+'"></div>'
    + '          <div><label>Unidade</label><input type="text" id="input-agendamento-unidade" placeholder="Ex.: un, kg, cx" value="'+esc(f.unidade)+'"></div>'
    + '        </div>'
    + '        <div class="field"><label>Fornecedor (opcional)</label><input type="text" id="input-agendamento-fornecedor" placeholder="Onde comprar, se já souber" value="'+esc(f.fornecedor)+'"></div>'
    + '        <div class="field"><label>Explicação</label><textarea class="obs-input" id="textarea-agendamento-explicacao" placeholder="Quem pediu, para que serve, urgência...">'+esc(f.explicacao)+'</textarea></div>'
    + '        <div class="field"><label>Atribuir a</label><select id="select-agendamento-responsavel">'+operadoresOptions+'</select>'
    + (operadores.length ? '' : '<div class="footnote">Nenhum operador cadastrado ainda — cadastre um operador na aba Usuários antes de atribuir um card.</div>')
    + '        </div>'
    + '      </div>'
    + '      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">'
    + '        <button class="btn secondary" data-close-agendamento>Cancelar</button>'
    + '        <button class="btn" id="btn-salvar-agendamento">'+(editando?'Salvar alterações':'Criar card')+'</button>'
    + '      </div>'
    + '    </div>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   TAB: Hora Extra
   ============================================================ */
function renderHoraExtra(){
  if(isChefeSetor()) return renderHoraExtraChefe();
  return renderHoraExtraConsolidado();
}

function renderHoraExtraPessoasRows(pessoas){
  return pessoas.map(function(pRaw, idx){
    var p = heNormPessoa(pRaw);
    return '<div class="he-pessoa-row">'
      + '<div class="quote-line" style="grid-template-columns:1fr auto">'
      + '<input type="text" placeholder="Nome da pessoa" data-he-pessoa-idx="'+idx+'" value="'+esc(p.nome)+'">'
      + (pessoas.length>1 ? '<button class="icon-btn" data-he-remove-pessoa="'+idx+'" title="Remover">'+icon('close')+'</button>' : '<span></span>')
      + '</div>'
      + '<div class="chip-row">'
      + '  <button type="button" class="chip sm'+(p.horario==='12:00'?' active':'')+'" data-he-horario-idx="'+idx+'" data-he-horario-valor="12:00">Até 12:00 (só lanche)</button>'
      + '  <button type="button" class="chip sm'+(p.horario==='15:00'?' active':'')+'" data-he-horario-idx="'+idx+'" data-he-horario-valor="15:00">Até 15:00 (lanche + marmita)</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function renderHoraExtraChefe(){
  var f = UI.horaExtra.form;
  var me = currentUsuario();
  var minhas = STATE.horaExtra.filter(function(h){ return me && h.criadoPorUserId===me.id; }).sort(function(a,b){ return (b.criadoEm||'').localeCompare(a.criadoEm||''); });
  var previewCounts = heCounts(heFilledPessoas(f.pessoas));

  var historicoHtml = minhas.map(function(h){
    var statusBadgeHtml = h.status==='comprado' ? '<span class="badge badge-good">Comprado</span>' : '<span class="badge badge-warn">Pendente</span>';
    var hPessoas = (h.pessoas||[]).map(heNormPessoa);
    var pessoasListHtml = hPessoas.map(function(p){ return esc(p.nome)+' <span class="hint">(até '+p.horario+')</span>'; }).join(' · ') || '—';
    return '<div class="alert-card" style="flex-direction:column;align-items:flex-start;gap:6px">'
      + '<div style="display:flex;justify-content:space-between;width:100%"><div class="alert-title">'+esc(h.setor)+' · '+dateBR((h.criadoEm||'').slice(0,10))+'</div>'+statusBadgeHtml+'</div>'
      + '<div class="alert-body">Responsável: '+esc(h.responsavelSolicitante)+' · '+hPessoas.length+' pessoa(s): '+pessoasListHtml+'</div>'
      + '<div class="alert-meta">'+num(h.qtdLanches||0)+' lanche(s) · '+num(h.qtdMarmitas||0)+' marmita(s)'+(h.observacao?' · obs.: '+esc(h.observacao):'')+'</div>'
      + '</div>';
  }).join('') || '<div class="footnote">Você ainda não fez nenhum pedido de hora extra.</div>';

  return ''
    + '<div class="card">'
    + '  <div class="card-head"><h2>Pedido de hora extra</h2><span class="hint">lanche e marmita para a equipe em hora extra</span></div>'
    + '  <div class="qform">'
    + '    <div class="field"><label>Setor</label><input type="text" id="input-he-setor" placeholder="Ex.: Manutenção" value="'+esc(f.setor)+'"></div>'
    + '    <div class="field"><label>Responsável pela solicitação</label><input type="text" id="input-he-responsavel" placeholder="Seu nome" value="'+esc(f.responsavelSolicitante)+'"></div>'
    + '    <div class="field"><label>Pessoas em hora extra — até que horário cada uma vai ficar</label>'
    + renderHoraExtraPessoasRows(f.pessoas)
    + '      <button class="btn ghost small" id="btn-he-add-pessoa" style="margin-top:4px">'+icon('plus')+' Adicionar pessoa</button>'
    + '    </div>'
    + '    <div class="ref-price-box">Lanches: <strong>'+num(previewCounts.lanches)+'</strong> · Marmitas: <strong>'+num(previewCounts.marmitas)+'</strong>'
    + '      <div class="footnote" style="margin-top:2px">Calculado automaticamente: até 12:00 conta só lanche; até 15:00 conta lanche + marmita.</div>'
    + '    </div>'
    + '    <div class="field"><label>Observação (opcional)</label><textarea class="obs-input" id="textarea-he-obs" placeholder="Ex.: fulano não come carne, alergia a...">'+esc(f.observacao)+'</textarea></div>'
    + '    <button class="btn" id="btn-enviar-hora-extra">Enviar pedido</button>'
    + '  </div>'
    + '</div>'
    + '<div class="card">'
    + '  <div class="card-head"><h2>Seus pedidos anteriores</h2></div>'
    + historicoHtml
    + '</div>';
}

function renderHoraExtraConsolidado(){
  var filtro = UI.horaExtra.filtroStatus;
  var todos = STATE.horaExtra.slice().sort(function(a,b){ return (b.criadoEm||'').localeCompare(a.criadoEm||''); });
  var pendentes = todos.filter(function(h){ return h.status==='pendente'; });
  var somaLanchesPend = pendentes.reduce(function(a,h){ return a+(h.qtdLanches||0); }, 0);
  var somaMarmitasPend = pendentes.reduce(function(a,h){ return a+(h.qtdMarmitas||0); }, 0);
  var somaLanchesTotal = todos.reduce(function(a,h){ return a+(h.qtdLanches||0); }, 0);
  var somaMarmitasTotal = todos.reduce(function(a,h){ return a+(h.qtdMarmitas||0); }, 0);

  var lista = filtro==='todos' ? todos : todos.filter(function(h){ return h.status===filtro; });
  var rows = lista.map(function(h){
    var statusBadgeHtml = h.status==='comprado' ? '<span class="badge badge-good">Comprado</span>' : '<span class="badge badge-warn">Pendente</span>';
    var hPessoas = (h.pessoas||[]).map(heNormPessoa);
    var pessoasCellHtml = hPessoas.length
      ? hPessoas.map(function(p){ return '<div class="cell-sub">'+esc(p.nome)+' <span class="hint">— até '+p.horario+(p.horario==='12:00'?' (só lanche)':' (lanche + marmita)')+'</span></div>'; }).join('')
      : '—';
    return '<tr>'
      + '<td class="cell-sub" style="white-space:nowrap">'+dateBR((h.criadoEm||'').slice(0,10))+'</td>'
      + '<td><div class="cell-primary">'+esc(titleCase(h.setor))+'</div><div class="cell-sub">'+esc(h.responsavelSolicitante)+'</div></td>'
      + '<td>'+pessoasCellHtml+'</td>'
      + '<td class="num">'+num(h.qtdLanches||0)+'</td>'
      + '<td class="num">'+num(h.qtdMarmitas||0)+'</td>'
      + '<td class="cell-sub">'+(h.observacao?esc(h.observacao):'—')+'</td>'
      + '<td>'+statusBadgeHtml+'</td>'
      + '<td><button class="btn ghost small" data-he-toggle-status="'+h.id+'">'+(h.status==='comprado'?'Marcar pendente':'Marcar comprado')+'</button></td>'
      + '</tr>';
  }).join('');

  var chips = ['todos','pendente','comprado'].map(function(st){
    var lbl = st==='todos' ? 'Todos' : st==='pendente' ? 'Pendentes' : 'Comprados';
    return '<button class="chip'+(filtro===st?' active':'')+'" data-he-filtro="'+st+'">'+lbl+'</button>';
  }).join('');

  return ''
    + '<div class="kpi-grid" style="margin-bottom:16px">'
    + kpiTile('Lanches pendentes', num(somaLanchesPend), num(pendentes.length)+' pedido(s) ainda não comprado(s)')
    + kpiTile('Marmitas pendentes', num(somaMarmitasPend), num(pendentes.length)+' pedido(s) ainda não comprado(s)')
    + kpiTile('Lanches (total)', num(somaLanchesTotal), num(todos.length)+' pedido(s) no total')
    + kpiTile('Marmitas (total)', num(somaMarmitasTotal), num(todos.length)+' pedido(s) no total')
    + '</div>'
    + '<div class="card">'
    + '  <div class="card-head"><h2>Pedidos de hora extra — todos os setores</h2><span class="hint">'+num(todos.length)+' pedido(s)</span></div>'
    + '  <div class="chip-row" style="margin-bottom:12px">'+chips+'</div>'
    + '  <div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>Setor / responsável</th><th>Pessoas</th><th class="num">Lanches</th><th class="num">Marmitas</th><th>Observação</th><th>Status</th><th></th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="8"><div class="empty-state">'+icon('food')+'<div>Nenhum pedido de hora extra registrado ainda.</div></div></td></tr>')
    + '</tbody></table></div>'
    + '</div>';
}

/* ============================================================
   Master render
   ============================================================ */
function render(){
  var appEl = document.getElementById('app');


  if(!currentUsuario()){
    appEl.innerHTML = renderAuthScreen();
    renderToasts();
    return;
  }
  if(isChefeSetor() && UI.tab!=='hora-extra'){ UI.tab = 'hora-extra'; }
  if(!UI.lembretesChecados){
    UI.lembretesChecados = true;
    if(gerarLembretesDiarios()>0){ persist('Lembretes diários atualizados.'); }
  }
  appEl.innerHTML = renderShell();
  renderToasts();

}


/* ============================================================
   Event delegation: click
   ============================================================ */
document.addEventListener('click', function(e){
  var el;

  if(UI.notifOpen && !e.target.closest('.notif-wrap')){ UI.notifOpen = false; render(); return; }

  if((el = e.target.closest('[data-nav]'))){ UI.tab = el.getAttribute('data-nav'); render(); return; }

  /* Autenticação: login / cadastro */
  if((el = e.target.closest('[data-auth-tab]'))){
    UI.auth.screen = el.getAttribute('data-auth-tab');
    UI.auth.loginErro=''; UI.auth.cadErro='';
    render(); return;
  }
  if(e.target.id==='btn-cadastro-voltar-login'){
    UI.auth.screen = 'login'; UI.auth.loginErro=''; UI.auth.cadErro='';
    render(); return;
  }
  if((el = e.target.closest('[data-cad-tipo]'))){
    /* Não chama render() aqui de propósito: os campos de nome/e-mail/ramal/senha do
       cadastro só são lidos do DOM no submit (não ficam sincronizados em UI.auth a
       cada tecla), então um render() no meio do preenchimento apagaria o que a pessoa
       já digitou. Só alternamos a classe "active" dos dois botões diretamente. */
    UI.auth.cadTipo = el.getAttribute('data-cad-tipo');
    var chipRow = document.getElementById('chip-row-cad-tipo');
    if(chipRow){
      var chipBtns = chipRow.querySelectorAll('[data-cad-tipo]');
      for(var ci=0; ci<chipBtns.length; ci++){
        chipBtns[ci].classList.toggle('active', chipBtns[ci].getAttribute('data-cad-tipo')===UI.auth.cadTipo);
      }
    }
    return;
  }
  if(e.target.id==='btn-login-submit'){
    if(UI.auth.busy) return;
    var emailIn = document.getElementById('input-login-email');
    var senhaIn = document.getElementById('input-login-senha');
    var emailV = emailIn ? emailIn.value.trim() : '';
    var senhaV = senhaIn ? senhaIn.value : '';
    UI.auth.loginEmail = emailV;
    if(!emailV || !senhaV){ UI.auth.loginErro = 'Informe e-mail e senha.'; render(); return; }
    var uLogin = encontrarUsuarioPorEmail(emailV);
    if(!uLogin){ UI.auth.loginErro = 'E-mail não encontrado. Verifique ou cadastre-se.'; render(); return; }
    UI.auth.busy = true; UI.auth.loginErro=''; render();
    sha256Hex(uLogin.salt + senhaV).then(function(hash){
      UI.auth.busy = false;
      if(hash===uLogin.senhaHash){
        var loginStatus = usuarioStatus(uLogin);
        if(loginStatus==='pendente'){ UI.auth.loginErro = 'Seu cadastro ainda está em análise. Aguarde a aprovação do administrador.'; render(); return; }
        if(loginStatus==='recusado'){ UI.auth.loginErro = 'Seu cadastro foi recusado. Fale com o administrador.'; render(); return; }
        UI.auth.sessionUserId = uLogin.id; saveSessionUserId(uLogin.id);
        UI.auth.loginEmail=''; UI.auth.loginSenha='';
        render();
      } else {
        UI.auth.loginErro = 'Senha incorreta.'; render();
      }
    }).catch(function(){
      UI.auth.busy = false; UI.auth.loginErro = 'Não foi possível verificar a senha neste navegador.'; render();
    });
    return;
  }
  if(e.target.id==='btn-cadastro-submit'){
    if(UI.auth.busy) return;
    var nomeIn = document.getElementById('input-cad-nome');
    var emailIn2 = document.getElementById('input-cad-email');
    var ramalIn = document.getElementById('input-cad-ramal');
    var senhaIn2 = document.getElementById('input-cad-senha');
    var senha2In = document.getElementById('input-cad-senha2');
    var codigoIn = document.getElementById('input-cad-codigo');
    var nomeV = nomeIn ? nomeIn.value.trim() : '';
    var emailV2 = emailIn2 ? emailIn2.value.trim() : '';
    var ramalV = ramalIn ? ramalIn.value.trim() : '';
    var senhaV2 = senhaIn2 ? senhaIn2.value : '';
    var senha2V = senha2In ? senha2In.value : '';
    var codigoV = codigoIn ? codigoIn.value.trim() : '';
    UI.auth.cadNome=nomeV; UI.auth.cadEmail=emailV2; UI.auth.cadRamal=ramalV; UI.auth.cadCodigo=codigoV;

    if(nomeV.length<3){ UI.auth.cadErro='Informe seu nome completo.'; render(); return; }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailV2)){ UI.auth.cadErro='Informe um e-mail válido.'; render(); return; }
    if(!ramalV){ UI.auth.cadErro='Informe o ramal.'; render(); return; }
    if(senhaV2.length<6){ UI.auth.cadErro='A senha precisa ter pelo menos 6 caracteres.'; render(); return; }
    if(senhaV2!==senha2V){ UI.auth.cadErro='As senhas não coincidem.'; render(); return; }
    if(encontrarUsuarioPorEmail(emailV2)){ UI.auth.cadErro='Já existe um cadastro com este e-mail. Use "Entrar".'; render(); return; }

    UI.auth.busy = true; UI.auth.cadErro=''; render();
    var novoSalt = randomSaltHex();
    Promise.all([
      sha256Hex(novoSalt + senhaV2),
      codigoV ? sha256Hex(codigoV) : Promise.resolve(null)
    ]).then(function(results){
      var senhaHash = results[0];
      var codigoHash = results[1];
      if(codigoV && codigoHash!==STATE.configAuth.adminCodeHash){
        UI.auth.busy = false;
        UI.auth.cadErro = 'Código de administrador inválido. Deixe o campo em branco para se cadastrar como operador.';
        render(); return;
      }
      /* Código de administrador válido é a própria vetagem: entra direto como admin,
         aprovado. Sem código (ou com o tipo de conta escolhido), o cadastro fica
         'pendente' até um administrador revisar e aprovar/recusar na aba Usuários —
         não fazemos login automático nesse caso. */
      var isAdminCode = !!(codigoV && codigoHash===STATE.configAuth.adminCodeHash);
      var papel = isAdminCode ? 'admin' : (UI.auth.cadTipo==='chefe_setor' ? 'chefe_setor' : 'operador');
      var status = isAdminCode ? 'aprovado' : 'pendente';
      var novoUsuario = {
        id: 'usr_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
        nomeCompleto: nomeV, email: emailV2, ramal: ramalV,
        salt: novoSalt, senhaHash: senhaHash, papel: papel, status: status,
        criadoEm: new Date().toISOString()
      };
      STATE.usuarios.push(novoUsuario);
      UI.auth.busy = false;
      UI.auth.cadNome=''; UI.auth.cadEmail=''; UI.auth.cadRamal=''; UI.auth.cadSenha=''; UI.auth.cadSenha2=''; UI.auth.cadCodigo=''; UI.auth.cadTipo='operador';
      if(isAdminCode){
        UI.auth.sessionUserId = novoUsuario.id; saveSessionUserId(novoUsuario.id);
        logAtividade(papelLabel(papel)+' cadastrado', novoUsuario.nomeCompleto+' ('+novoUsuario.email+')');
        persist('Cadastro criado.'); render();
      } else {
        UI.auth.screen = 'enviado';
        logAtividade('Cadastro enviado para aprovação', novoUsuario.nomeCompleto+' ('+novoUsuario.email+') solicitou acesso como '+papelLabel(papel));
        toast('Cadastro enviado! Aguarde a aprovação do administrador.');
        persist('Novo cadastro aguardando aprovação.'); render();
      }
    }).catch(function(){
      UI.auth.busy = false; UI.auth.cadErro = 'Não foi possível concluir o cadastro neste navegador.'; render();
    });
    return;
  }

  /* Usuários (somente administrador) */
  if((el = e.target.closest('[data-pending-role]'))){
    if(!isAdmin()) return;
    var prId = el.getAttribute('data-pending-role');
    var prRole = el.getAttribute('data-role');
    UI.usuarios.pendingRoleOverride = UI.usuarios.pendingRoleOverride || {};
    UI.usuarios.pendingRoleOverride[prId] = prRole==='chefe_setor' ? 'chefe_setor' : 'operador';
    render(); return;
  }
  if((el = e.target.closest('[data-aprovar-usuario]'))){
    if(!isAdmin()) return;
    var apId = el.getAttribute('data-aprovar-usuario');
    var apU = STATE.usuarios.find(function(x){return x.id===apId;});
    if(apU){
      var override = (UI.usuarios.pendingRoleOverride || {})[apId];
      var papelFinal = override || apU.papel;
      if(papelFinal!=='chefe_setor') papelFinal = 'operador';
      apU.papel = papelFinal; apU.status = 'aprovado';
      if(UI.usuarios.pendingRoleOverride) delete UI.usuarios.pendingRoleOverride[apId];
      logAtividade('Cadastro aprovado', apU.nomeCompleto+' ('+apU.email+') — '+papelLabel(apU.papel));
      persist('Cadastro aprovado.'); render();
    }
    return;
  }
  if((el = e.target.closest('[data-recusar-usuario]'))){
    if(!isAdmin()) return;
    var rcId = el.getAttribute('data-recusar-usuario');
    var rcU = STATE.usuarios.find(function(x){return x.id===rcId;});
    if(rcU){
      rcU.status = 'recusado';
      if(UI.usuarios.pendingRoleOverride) delete UI.usuarios.pendingRoleOverride[rcId];
      logAtividade('Cadastro recusado', rcU.nomeCompleto+' ('+rcU.email+')');
      persist('Cadastro recusado.'); render();
    }
    return;
  }
  if((el = e.target.closest('[data-reconsiderar-usuario]'))){
    if(!isAdmin()) return;
    var rvId = el.getAttribute('data-reconsiderar-usuario');
    var rvU = STATE.usuarios.find(function(x){return x.id===rvId;});
    if(rvU){
      rvU.status = 'pendente';
      logAtividade('Cadastro recusado movido de volta para pendente', rvU.nomeCompleto+' ('+rvU.email+')');
      persist('Cadastro voltou para pendente.'); render();
    }
    return;
  }
  if((el = e.target.closest('[data-excluir-recusado]'))){
    if(!isAdmin()) return;
    var exId = el.getAttribute('data-excluir-recusado');
    var exU = STATE.usuarios.find(function(x){return x.id===exId;});
    if(exU){
      STATE.usuarios = STATE.usuarios.filter(function(x){return x.id!==exId;});
      logAtividade('Cadastro recusado excluído', exU.nomeCompleto+' ('+exU.email+')');
      persist('Cadastro excluído.'); render();
    }
    return;
  }
  if((el = e.target.closest('[data-definir-papel-usuario]'))){
    if(!isAdmin()) return;
    var tuId = el.getAttribute('data-definir-papel-usuario');
    var novoPapelTu = el.getAttribute('data-novo-papel');
    var tu = STATE.usuarios.find(function(x){return x.id===tuId;});
    if(tu){
      if(tu.papel==='admin' && novoPapelTu!=='admin' && contarAdmins()<=1){ toast('Precisa haver ao menos um administrador.', true); return; }
      tu.papel = novoPapelTu;
      logAtividade('Papel de usuário alterado', tu.nomeCompleto+' agora é '+papelLabel(tu.papel));
      persist('Papel atualizado.'); render();
    }
    return;
  }
  if((el = e.target.closest('[data-remover-usuario]'))){
    if(!isAdmin()) return;
    var ruId = el.getAttribute('data-remover-usuario');
    if(currentUsuario() && currentUsuario().id===ruId){ toast('Você não pode remover a própria conta enquanto estiver logado.', true); return; }
    var ru = STATE.usuarios.find(function(x){return x.id===ruId;});
    if(ru){
      if(ru.papel==='admin' && contarAdmins()<=1){ toast('Precisa haver ao menos um administrador.', true); return; }
      STATE.usuarios = STATE.usuarios.filter(function(x){return x.id!==ruId;});
      logAtividade('Usuário removido', ru.nomeCompleto+' ('+ru.email+')');
      persist('Usuário removido.'); render();
    }
    return;
  }
  if((el = e.target.closest('[data-redefinir-senha-usuario]'))){
    if(!isAdmin()) return;
    var rsId = el.getAttribute('data-redefinir-senha-usuario');
    var rsInput = document.getElementById('input-reset-senha-'+rsId);
    var novaSenha = rsInput ? rsInput.value : '';
    if(novaSenha.length<6){ toast('A nova senha precisa ter pelo menos 6 caracteres.', true); return; }
    var ruser = STATE.usuarios.find(function(x){return x.id===rsId;});
    if(!ruser) return;
    var salt2 = randomSaltHex();
    sha256Hex(salt2 + novaSenha).then(function(hash){
      ruser.salt = salt2; ruser.senhaHash = hash;
      logAtividade('Senha redefinida por administrador', ruser.nomeCompleto);
      persist('Senha redefinida.'); render();
    });
    return;
  }
  if(e.target.id==='btn-salvar-empresa-nome'){
    if(!isAdmin()) return;
    var empNomeEl = document.getElementById('input-empresa-nome');
    var empNomeVal = empNomeEl ? empNomeEl.value.trim() : '';
    STATE.empresa.nome = empNomeVal;
    logAtividade('Nome da empresa atualizado', empNomeVal || '(em branco)');
    persist('Nome da empresa salvo.'); render();
    return;
  }
  if(e.target.id==='btn-salvar-codigo-admin'){
    if(!isAdmin()) return;
    var novoCodigoEl = document.getElementById('input-novo-codigo-admin');
    var novoCodigo = novoCodigoEl ? novoCodigoEl.value.trim() : '';
    if(novoCodigo.length<6){ toast('Use um código com pelo menos 6 caracteres.', true); return; }
    sha256Hex(novoCodigo).then(function(hash){
      STATE.configAuth.adminCodeHash = hash;
      UI.usuarios.novoCodigoAdmin = '';
      logAtividade('Código de cadastro de administrador alterado', '');
      persist('Código de administrador atualizado.'); render();
    });
    return;
  }

  /* Identidade / branding / exportação */
  if(e.target.id==='btn-logout'){
    UI.auth.sessionUserId = ''; saveSessionUserId('');
    UI.auth.screen = 'login'; UI.auth.loginEmail=''; UI.auth.loginSenha=''; UI.auth.loginErro='';
    render(); return;
  }
  if(e.target.id==='btn-exportar-relatorio'){ window.print(); return; }

  /* Fornecedores */
  if((el = e.target.closest('[data-fornecedor-abc]'))){ UI.fornecedores.abc = el.getAttribute('data-fornecedor-abc'); UI.fornecedores.limit = 60; render(); return; }
  if((el = e.target.closest('[data-sort-fornecedor]'))){
    var key = el.getAttribute('data-sort-fornecedor');
    if(UI.fornecedores.sortKey===key){ UI.fornecedores.sortDir = UI.fornecedores.sortDir==='asc'?'desc':'asc'; } else { UI.fornecedores.sortKey = key; UI.fornecedores.sortDir='desc'; }
    render(); return;
  }
  if((el = e.target.closest('[data-open-fornecedor]'))){ UI.editingFornecedor = el.getAttribute('data-open-fornecedor'); UI.tab = 'fornecedores'; render(); return; }
  if(e.target.id==='fornecedor-modal-backdrop' || e.target.closest('[data-close-fornecedor]')){ UI.editingFornecedor = null; render(); return; }
  if((el = e.target.closest('[data-star-fornecedor]'))){
    var cod = el.getAttribute('data-star-fornecedor'); var n = parseInt(el.getAttribute('data-star'),10);
    var cur = getAvaliacao(cod); STATE.avaliacoes[cod] = { nota: n, status: cur.status, obs: cur.obs }; render(); return;
  }
  if((el = e.target.closest('[data-save-fornecedor]'))){
    var codigo = el.getAttribute('data-save-fornecedor');
    var statusSel = document.getElementById('select-fornecedor-status');
    var obsEl = document.getElementById('textarea-fornecedor-obs');
    var cidadeEl = document.getElementById('input-fornecedor-cidade');
    var ufEl = document.getElementById('input-fornecedor-uf');
    var contatoNomeEl = document.getElementById('input-fornecedor-contato-nome');
    var telefoneEl = document.getElementById('input-fornecedor-telefone');
    var emailEl = document.getElementById('input-fornecedor-email');
    var fiscalEl = document.getElementById('select-fornecedor-fiscal');
    var isoEl = document.getElementById('chk-fornecedor-iso9001');
    var laudoEl = document.getElementById('chk-fornecedor-laudo');
    var seguroEl = document.getElementById('chk-fornecedor-seguro');
    var certValEl = document.getElementById('input-fornecedor-cert-validade');
    var esgEl = document.getElementById('chk-fornecedor-esg');
    var esgObsEl = document.getElementById('textarea-fornecedor-esg-obs');
    var razaoSocialEl = document.getElementById('input-fornecedor-razao-social');
    var cnpjEl = document.getElementById('input-fornecedor-cnpj');
    var condPagEl = document.getElementById('input-fornecedor-condicao-pagamento');
    var enderecoEl = document.getElementById('input-fornecedor-endereco');
    var curAv = getAvaliacao(codigo);
    STATE.avaliacoes[codigo] = {
      nota: curAv.nota, status: statusSel ? statusSel.value : curAv.status, obs: obsEl ? obsEl.value : curAv.obs,
      endereco: enderecoEl ? enderecoEl.value.trim() : curAv.endereco,
      cidade: cidadeEl ? cidadeEl.value.trim() : curAv.cidade,
      uf: ufEl ? ufEl.value.trim().toUpperCase() : curAv.uf,
      contatoNome: contatoNomeEl ? contatoNomeEl.value.trim() : curAv.contatoNome,
      telefone: telefoneEl ? telefoneEl.value.trim() : curAv.telefone,
      email: emailEl ? emailEl.value.trim() : curAv.email,
      situacaoFiscal: fiscalEl ? fiscalEl.value : curAv.situacaoFiscal,
      certISO9001: isoEl ? isoEl.checked : curAv.certISO9001,
      certLaudo: laudoEl ? laudoEl.checked : curAv.certLaudo,
      certSeguroRC: seguroEl ? seguroEl.checked : curAv.certSeguroRC,
      certValidade: certValEl ? certValEl.value : curAv.certValidade,
      esgPolitica: esgEl ? esgEl.checked : curAv.esgPolitica,
      esgObs: esgObsEl ? esgObsEl.value : curAv.esgObs,
      razaoSocial: razaoSocialEl ? razaoSocialEl.value.trim() : curAv.razaoSocial,
      cnpj: cnpjEl ? cnpjEl.value.trim() : curAv.cnpj,
      condicaoPagamento: condPagEl ? condPagEl.value.trim() : curAv.condicaoPagamento,
      certificadoAnexo: curAv.certificadoAnexo
    };
    var fornObj = STATE.fornecedores.find(function(x){return x.codigo===codigo;});
    logAtividade('Avaliação de fornecedor atualizada', fornObj ? titleCase(fornObj.nome) : codigo);
    UI.editingFornecedor = null; persist('Avaliação salva.'); render(); return;
  }
  if(e.target.id==='btn-fornecedores-mais'){ UI.fornecedores.limit += 60; render(); return; }
  if(e.target.id==='btn-abrir-novo-fornecedor'){
    UI.novoFornecedorAberto = true; render();
    setTimeout(function(){ var el = document.getElementById('input-novo-fornecedor-nome'); if(el) el.focus(); }, 0);
    return;
  }
  if(e.target.id==='novo-fornecedor-modal-backdrop' || e.target.closest('[data-close-novo-fornecedor]')){ UI.novoFornecedorAberto = false; render(); return; }
  if(e.target.id==='btn-salvar-novo-fornecedor'){
    var nomeElN = document.getElementById('input-novo-fornecedor-nome');
    var nomeValN = nomeElN ? nomeElN.value.trim() : '';
    if(!nomeValN){ toast('Informe o nome do fornecedor.', true); return; }
    var razaoElN = document.getElementById('input-novo-fornecedor-razao-social');
    var cnpjElN = document.getElementById('input-novo-fornecedor-cnpj');
    var condPagElN = document.getElementById('input-novo-fornecedor-condicao-pagamento');
    var statusElN = document.getElementById('select-novo-fornecedor-status');
    var obsElN = document.getElementById('textarea-novo-fornecedor-obs');
    var contatoNomeElN = document.getElementById('input-novo-fornecedor-contato-nome');
    var telefoneElN = document.getElementById('input-novo-fornecedor-telefone');
    var emailElN = document.getElementById('input-novo-fornecedor-email');
    var enderecoElN = document.getElementById('input-novo-fornecedor-endereco');
    var cidadeElN = document.getElementById('input-novo-fornecedor-cidade');
    var ufElN = document.getElementById('input-novo-fornecedor-uf');
    var novoCodigo = gerarCodigoFornecedor();
    STATE.fornecedores.push({
      codigo: novoCodigo, codigosMesclados: [], nome: nomeValN,
      nPedidos: 0, nProdutos: 0, spend: 0, pct: 0, cumPct: 0, abc: null,
      primeiro: null, ultimo: null, tipoPrincipal: null
    });
    var novaAv = {
      nota: 0, status: statusElN ? statusElN.value : 'nao_avaliado', obs: obsElN ? obsElN.value.trim() : '',
      endereco: enderecoElN ? enderecoElN.value.trim() : '',
      cidade: cidadeElN ? cidadeElN.value.trim() : '',
      uf: ufElN ? ufElN.value.trim().toUpperCase() : '',
      contatoNome: contatoNomeElN ? contatoNomeElN.value.trim() : '',
      telefone: telefoneElN ? telefoneElN.value.trim() : '',
      email: emailElN ? emailElN.value.trim() : '',
      razaoSocial: razaoElN ? razaoElN.value.trim() : '',
      cnpj: cnpjElN ? cnpjElN.value.trim() : '',
      condicaoPagamento: condPagElN ? condPagElN.value.trim() : ''
    };
    STATE.avaliacoes[novoCodigo] = novaAv;
    logAtividade('Novo fornecedor cadastrado', titleCase(nomeValN));
    UI.novoFornecedorAberto = false;
    UI.fornecedores.search = ''; UI.fornecedores.limit = 60;
    persist('Fornecedor cadastrado.');
    render();
    return;
  }

  /* Itens */
  if((el = e.target.closest('[data-item-quad]'))){ UI.itens.quadrante = el.getAttribute('data-item-quad'); UI.itens.limit = 60; render(); return; }
  if((el = e.target.closest('[data-sort-item]'))){
    var ikey = el.getAttribute('data-sort-item');
    if(UI.itens.sortKey===ikey){ UI.itens.sortDir = UI.itens.sortDir==='asc'?'desc':'asc'; } else { UI.itens.sortKey = ikey; UI.itens.sortDir='desc'; }
    render(); return;
  }
  if(e.target.id==='btn-itens-mais'){ UI.itens.limit += 60; render(); return; }

  /* Compras por período */
  if(e.target.id==='btn-compras-meses-mais'){ UI.comprasPeriodo.limitMeses += 12; render(); return; }
  if(e.target.id==='btn-compras-semanas-mais'){ UI.comprasPeriodo.limitSemanas += 12; render(); return; }

  /* Cotações */
  if(e.target.id==='btn-abrir-cotacao'){
    UI.cotacoes.showForm = true; UI.cotacoes.formObraId=''; UI.cotacoes.formObs=''; UI.cotacoes.formSolicitante=''; UI.cotacoes.formSetor='';
    UI.cotacoes.formItensCotados = [blankItemCotado()];
    render(); return;
  }
  if(e.target.id==='btn-cancelar-cotacao'){ UI.cotacoes.showForm = false; render(); return; }
  if((el = e.target.closest('[data-pick-item]'))){
    var pcod = el.getAttribute('data-pick-item'); var pidx = parseInt(el.getAttribute('data-item-idx'),10);
    var pProd = produtosAtivos().find(function(p){return itemAggKey(p)===pcod;});
    UI.cotacoes.formItensCotados[pidx].itemSel = pProd;
    UI.cotacoes.formItensCotados[pidx].itemBusca = pProd ? (pProd.codigo ? (pProd.codigo+' — '+titleCase(pProd.descricao)) : titleCase(pProd.descricao)) : '';
    UI.cotacoes.formItensCotados[pidx].dismissSuggestions = true;
    render(); return;
  }
  if((el = e.target.closest('[data-pick-item-custom]'))){
    var pcDesc = el.getAttribute('data-pick-item-custom'); var pcIdx = parseInt(el.getAttribute('data-item-idx'),10);
    UI.cotacoes.formItensCotados[pcIdx].itemSel = null;
    UI.cotacoes.formItensCotados[pcIdx].itemBusca = pcDesc;
    UI.cotacoes.formItensCotados[pcIdx].dismissSuggestions = true;
    render(); return;
  }
  if(e.target.id==='btn-add-cotacao-item'){
    UI.cotacoes.formItensCotados.push(blankItemCotado());
    render(); return;
  }
  if((el = e.target.closest('[data-remove-cotacao-item]'))){
    var rmItemIdx = parseInt(el.getAttribute('data-remove-cotacao-item'),10);
    if(UI.cotacoes.formItensCotados.length>1){ UI.cotacoes.formItensCotados.splice(rmItemIdx,1); render(); }
    return;
  }
  if((el = e.target.closest('[data-add-quote-line]'))){
    var aqlIdx = parseInt(el.getAttribute('data-add-quote-line'),10);
    UI.cotacoes.formItensCotados[aqlIdx].linhas.push(blankOrcamentoLinha()); render(); return;
  }
  if((el = e.target.closest('[data-remove-quote-line]'))){
    var rqItemIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var rqLineIdx = parseInt(el.getAttribute('data-quote-idx-rm'),10);
    if(UI.cotacoes.formItensCotados[rqItemIdx].linhas.length<=MIN_ORCAMENTOS){
      toast('Cada item precisa de no mínimo '+MIN_ORCAMENTOS+' orçamentos.', true); return;
    }
    UI.cotacoes.formItensCotados[rqItemIdx].linhas.splice(rqLineIdx,1); render(); return;
  }
  if(e.target.id==='btn-salvar-cotacao'){
    var c = UI.cotacoes;
    var itensValidos = [];
    var errosValidacao = [];
    for(var bi=0; bi<c.formItensCotados.length; bi++){
      var blk = c.formItensCotados[bi];
      var descricaoFinal = blk.itemSel ? blk.itemSel.descricao : (blk.itemBusca||'').trim();
      if(!descricaoFinal) continue;
      /* Política: todo item precisa de no mínimo MIN_ORCAMENTOS orçamentos COMPLETOS —
         fornecedor, preço e foto do item — antes de poder ser registrado. Um administrador
         escolhe depois qual desses orçamentos aceita (ou recusa a cotação inteira). */
      var linhasCompletas = blk.linhas.filter(function(l){ return l.fornecedor.trim() && (l.preco+'').trim() && l.foto; });
      var linhasComAlgo = blk.linhas.filter(function(l){ return l.fornecedor.trim() || (l.preco+'').trim() || l.foto; });
      if(linhasCompletas.length < MIN_ORCAMENTOS){
        if(linhasComAlgo.length===0){ continue; } // bloco de item totalmente em branco: ignora, não é erro
        errosValidacao.push('O item "'+titleCase(descricaoFinal)+'" precisa de no mínimo '+MIN_ORCAMENTOS+' orçamentos completos (fornecedor, preço e foto do item) — atualmente há '+linhasCompletas.length+' completo(s).');
        continue;
      }
      itensValidos.push({
        itemCodigo: blk.itemSel ? blk.itemSel.codigo : null, itemDescricao: descricaoFinal, quantidade: parseNum(blk.qtd),
        unidade: (blk.unidade||'').trim(),
        linhas: linhasCompletas.map(function(l){ return { fornecedor: l.fornecedor.trim(), preco: parseNum(l.preco), prazo: l.prazo, foto: l.foto, fotoNome: l.fotoNome||null }; }),
        vencedor: null, status: 'aberta'
      });
      if(!blk.itemSel) registerItemPersonalizado(descricaoFinal);
    }
    if(errosValidacao.length){ toast(errosValidacao[0], true); return; }
    if(!itensValidos.length){ toast('Digite ao menos um item com no mínimo '+MIN_ORCAMENTOS+' orçamentos completos (fornecedor, preço e foto).', true); return; }
    var autorCotacao = currentUsuario();
    var novaCotacao = {
      id: 'cot_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
      criadoEm: new Date().toISOString(), obraId: c.formObraId || null, obs: c.formObs,
      solicitante: (c.formSolicitante||'').trim(), setor: (c.formSetor||'').trim(),
      criadoPorUserId: autorCotacao ? autorCotacao.id : null,
      itensCotados: itensValidos
    };
    STATE.cotacoes.unshift(novaCotacao);
    logAtividade('Cotação registrada', itensValidos.map(function(it){return it.itemDescricao;}).join(', '));
    c.showForm = false; persist('Cotação registrada.'); render(); return;
  }
  if((el = e.target.closest('[data-close-cotacao]'))){
    if(!isAdmin()){ toast('Somente um administrador pode aceitar um orçamento e dar continuidade ao pedido.', true); return; }
    var cid = el.getAttribute('data-close-cotacao'); var venc = el.getAttribute('data-vencedor'); var ciIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var cotObj = STATE.cotacoes.find(function(x){return x.id===cid;});
    if(cotObj){
      var itemToClose = cotObj.itensCotados[ciIdx];
      var linhaCheck = itemToClose.linhas.find(function(l){return l.fornecedor===venc;});
      var valorTotalCheck = (itemToClose.quantidade||0) * (linhaCheck?parseFloat(linhaCheck.preco)||0:0);
      var nCotacoesDistintas = itemToClose.linhas.length;
      var precisaExcecao = valorTotalCheck > STATE.configAprovacao.minCotacoesValor && nCotacoesDistintas < STATE.configAprovacao.minCotacoesQtd;
      if(precisaExcecao){
        UI.cotacoes.pendingExceptionId = cid;
        UI.cotacoes.pendingExceptionItemIdx = ciIdx;
        UI.cotacoes.pendingExceptionVencedor = venc;
        UI.cotacoes.exceptionText = '';
        render(); return;
      }
      closeCotacaoItem(cotObj, ciIdx, venc);
      logAtividade('Cotação aceita, pedido em continuidade', itemToClose.itemDescricao+' — orçamento aceito: '+venc);
    }
    persist('Cotação aceita — pedido em continuidade.'); render(); return;
  }
  if(e.target.id==='btn-cancelar-excecao-cotacao'){
    UI.cotacoes.pendingExceptionId = null; UI.cotacoes.pendingExceptionItemIdx = null; UI.cotacoes.pendingExceptionVencedor = null; UI.cotacoes.exceptionText = '';
    render(); return;
  }
  if((el = e.target.closest('[data-confirmar-excecao-cotacao]'))){
    if(!isAdmin()){ toast('Somente um administrador pode aceitar um orçamento e dar continuidade ao pedido.', true); return; }
    var cidE = el.getAttribute('data-confirmar-excecao-cotacao'); var ceIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var justif = (UI.cotacoes.exceptionText||'').trim();
    if(!justif){ toast('Descreva o motivo para seguir sem o mínimo de cotações.', true); return; }
    var cotE = STATE.cotacoes.find(function(x){return x.id===cidE;});
    if(cotE){
      var itemE = cotE.itensCotados[ceIdx];
      closeCotacaoItem(cotE, ceIdx, UI.cotacoes.pendingExceptionVencedor, justif);
      logAtividade('Cotação fechada com exceção', itemE.itemDescricao+' — '+justif);
    }
    UI.cotacoes.pendingExceptionId = null; UI.cotacoes.pendingExceptionItemIdx = null; UI.cotacoes.pendingExceptionVencedor = null; UI.cotacoes.exceptionText = '';
    persist('Cotação fechada com exceção registrada.'); render(); return;
  }
  if((el = e.target.closest('[data-aprovar-cotacao]'))){
    if(!isAdmin()){ toast('Somente um administrador pode aprovar cotações.', true); return; }
    var acid = el.getAttribute('data-aprovar-cotacao'); var aiIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var nomeAprov = currentUsuario().nomeCompleto;
    var cotA = STATE.cotacoes.find(function(x){return x.id===acid;});
    var itemA = cotA ? cotA.itensCotados[aiIdx] : null;
    if(itemA){ itemA.status='aprovada'; itemA.aprovadoPor=nomeAprov; itemA.aprovadoEm=new Date().toISOString(); criarPedidoParaItem(cotA, itemA, aiIdx); }
    logAtividade('Cotação aprovada', (itemA?itemA.itemDescricao:acid)+' — por '+nomeAprov);
    persist('Cotação aprovada.'); render(); return;
  }
  if((el = e.target.closest('[data-recusar-cotacao]'))){
    if(!isAdmin()){ toast('Somente um administrador pode recusar cotações.', true); return; }
    UI.cotacoes.pendingRejectId = el.getAttribute('data-recusar-cotacao');
    UI.cotacoes.pendingRejectItemIdx = parseInt(el.getAttribute('data-item-idx'),10);
    UI.cotacoes.rejectText = '';
    render(); return;
  }
  if(e.target.id==='btn-cancelar-recusa-cotacao'){
    UI.cotacoes.pendingRejectId = null; UI.cotacoes.pendingRejectItemIdx = null; UI.cotacoes.rejectText = '';
    render(); return;
  }
  if((el = e.target.closest('[data-confirmar-recusa-cotacao]'))){
    if(!isAdmin()){ toast('Somente um administrador pode recusar cotações.', true); return; }
    var rcid2 = el.getAttribute('data-confirmar-recusa-cotacao'); var riIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var nomeRecusa = currentUsuario().nomeCompleto;
    var motivo = (UI.cotacoes.rejectText||'').trim();
    var cotR2 = STATE.cotacoes.find(function(x){return x.id===rcid2;});
    var itemR2 = cotR2 ? cotR2.itensCotados[riIdx] : null;
    if(itemR2){
      itemR2.status='recusada'; itemR2.recusadoPor=nomeRecusa; itemR2.recusadoEm=new Date().toISOString(); itemR2.motivoRecusa=motivo||null;
      itemR2.acompanhamento = null;
      criarNotificacao(cotR2.criadoPorUserId, 'recusada', cotR2, itemR2, riIdx);
    }
    logAtividade('Cotação recusada', (itemR2?itemR2.itemDescricao:rcid2)+' — por '+nomeRecusa+(motivo?' — motivo: '+motivo:''));
    UI.cotacoes.pendingRejectId = null; UI.cotacoes.pendingRejectItemIdx = null; UI.cotacoes.rejectText = '';
    persist('Cotação recusada.'); render(); return;
  }
  if((el = e.target.closest('[data-reabrir-cotacao]'))){
    if(!isAdmin()){ toast('Somente um administrador pode reabrir uma cotação recusada.', true); return; }
    var rbid = el.getAttribute('data-reabrir-cotacao'); var rbIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var cotRb = STATE.cotacoes.find(function(x){return x.id===rbid;});
    var itemRb = cotRb ? cotRb.itensCotados[rbIdx] : null;
    if(itemRb){
      itemRb.status='aberta'; itemRb.vencedor=null; itemRb.fechadoEm=null;
      itemRb.aprovadoPor=null; itemRb.aprovadoEm=null;
      itemRb.recusadoPor=null; itemRb.recusadoEm=null; itemRb.motivoRecusa=null;
      itemRb.acompanhamento = null;
    }
    logAtividade('Cotação reaberta para nova cotação', itemRb?itemRb.itemDescricao:rbid);
    persist('Cotação reaberta.'); render(); return;
  }
  if((el = e.target.closest('[data-cotacao-filtro]'))){ UI.cotacoes.filtro = el.getAttribute('data-cotacao-filtro'); render(); return; }
  if(e.target.id==='btn-salvar-min-cot'){
    var minValInput = document.getElementById('input-min-cot-valor');
    var minQtdInput = document.getElementById('input-min-cot-qtd');
    var mv = parseNum(minValInput.value);
    var mq = parseInt(minQtdInput.value,10);
    if(mv<=0 || !mq || mq<=0){ toast('Informe valores válidos.', true); return; }
    STATE.configAprovacao.minCotacoesValor = mv; STATE.configAprovacao.minCotacoesQtd = mq;
    logAtividade('Política de mínimo de cotações alterada', money(mv)+' / '+mq+' cotações');
    persist('Política de mínimo de cotações atualizada.'); render(); return;
  }

  /* Notificações (sino) */
  if(e.target.id==='btn-toggle-notificacoes' || e.target.closest('#btn-toggle-notificacoes')){
    UI.notifOpen = !UI.notifOpen; render(); return;
  }
  if(e.target.id==='btn-fechar-notificacoes' || e.target.closest('#btn-fechar-notificacoes')){
    UI.notifOpen = false; render(); return;
  }
  if(e.target.id==='btn-marcar-todas-lidas'){
    notificacoesDoUsuario().forEach(function(n){ n.lida = true; });
    persist('Notificações marcadas como lidas.'); render(); return;
  }
  if((el = e.target.closest('[data-marcar-lida]'))){
    var mlId = el.getAttribute('data-marcar-lida');
    var mlNotif = STATE.notificacoes.find(function(n){ return n.id===mlId; });
    if(mlNotif){ mlNotif.lida = true; }
    persist('Notificação marcada como lida.'); render(); return;
  }
  if((el = e.target.closest('[data-ver-cotacao-notif]'))){
    var vcNotifId = el.getAttribute('data-ver-cotacao-notif');
    var vcCotId = el.getAttribute('data-cotacao-id');
    var vcNotif = STATE.notificacoes.find(function(n){ return n.id===vcNotifId; });
    var vcCot = STATE.cotacoes.find(function(c){ return c.id===vcCotId; });
    var vcItem = (vcNotif && vcCot) ? (vcCot.itensCotados||[])[vcNotif.itemIdx] : null;
    if(vcNotif){ vcNotif.lida = true; }
    UI.notifOpen = false;
    UI.tab = 'cotacoes';
    if(vcItem){
      if(vcItem.status==='aprovada'){ UI.cotacoes.filtro = 'aprovadas'; }
      else if(vcItem.status==='recusada'){ UI.cotacoes.filtro = 'recusadas'; }
      else { UI.cotacoes.filtro = 'abertas'; }
    }
    persist('Notificação marcada como lida.'); render(); return;
  }
  if((el = e.target.closest('[data-set-acompanhamento]'))){
    var saVal = el.getAttribute('data-set-acompanhamento');
    var saCotId = el.getAttribute('data-cotacao-id');
    var saItemIdx = parseInt(el.getAttribute('data-item-idx'),10);
    var saNotifId = el.getAttribute('data-notif-id');
    var saCot = STATE.cotacoes.find(function(c){ return c.id===saCotId; });
    var saItem = saCot ? (saCot.itensCotados||[])[saItemIdx] : null;
    if(!saItem || saItem.status!=='aprovada'){ toast('Este item não está mais aprovado.', true); return; }
    saItem.acompanhamento = saVal;
    if(saNotifId){
      var saNotif = STATE.notificacoes.find(function(n){ return n.id===saNotifId; });
      if(saNotif){ saNotif.lida = true; }
    }
    logAtividade('Acompanhamento de cotação atualizado', (saItem.itemDescricao||saCotId)+' — '+ACOMPANHAMENTO_LABEL[saVal]);
    persist('Acompanhamento atualizado: '+ACOMPANHAMENTO_LABEL[saVal]+'.'); render(); return;
  }

  /* Reposição */
  if((el = e.target.closest('[data-reposicao-quad]'))){ UI.reposicao.quadrante = el.getAttribute('data-reposicao-quad'); UI.reposicao.limit=60; render(); return; }
  if((el = e.target.closest('[data-sort-reposicao]'))){
    var rkey = el.getAttribute('data-sort-reposicao');
    if(UI.reposicao.sortKey===rkey){ UI.reposicao.sortDir = UI.reposicao.sortDir==='asc'?'desc':'asc'; } else { UI.reposicao.sortKey = rkey; UI.reposicao.sortDir='desc'; }
    render(); return;
  }
  if(e.target.id==='btn-reposicao-mais'){ UI.reposicao.limit += 60; render(); return; }
  if((el = e.target.closest('[data-reposicao-abaixo-ponto]'))){ UI.reposicao.abaixoPonto = !UI.reposicao.abaixoPonto; UI.reposicao.limit=60; render(); return; }
  if(e.target.id==='btn-salvar-cobertura'){
    var covInput = document.getElementById('input-cobertura');
    var cv = parseInt(covInput.value,10);
    if(!cv || cv<=0){ toast('Informe um número de dias válido.', true); return; }
    STATE.configReposicao.coberturaDias = cv; persist('Cobertura atualizada.'); render(); return;
  }

  /* Contratos */
  if(e.target.id==='btn-abrir-contrato'){
    UI.contratos.showForm = true;
    UI.contratos.form = { fornecedorBusca:'', fornecedorNome:'', fornecedorCodigo:'', escopo:'', precoBase:'', indice:'IPCA', periodicidade:'anual', dataInicio: todayISO(), obs:'', obraId:'' };
    UI.contratos.anexoDraft = null;
    render(); return;
  }
  if(e.target.id==='btn-cancelar-contrato'){ UI.contratos.showForm = false; render(); return; }
  if((el = e.target.closest('[data-pick-fornecedor-contrato]'))){
    var fcod = el.getAttribute('data-pick-fornecedor-contrato');
    var forn = STATE.fornecedores.find(function(s){return s.codigo===fcod;});
    if(forn){ UI.contratos.form.fornecedorNome = forn.nome; UI.contratos.form.fornecedorCodigo = forn.codigo; }
    render(); return;
  }
  if(e.target.id==='btn-salvar-contrato'){
    var cf = UI.contratos.form;
    var precoEl = document.getElementById('input-contrato-preco');
    var escopoEl = document.getElementById('input-contrato-escopo');
    var dataEl = document.getElementById('input-contrato-data');
    var indiceEl = document.getElementById('select-contrato-indice');
    var periodEl = document.getElementById('select-contrato-periodicidade');
    var obsEl2 = document.getElementById('textarea-contrato-obs');
    if(!cf.fornecedorNome){ toast('Selecione um fornecedor cadastrado.', true); return; }
    if(!escopoEl.value.trim()){ toast('Descreva o escopo do contrato.', true); return; }
    if(!dataEl.value){ toast('Informe a data de início.', true); return; }
    var periodicidade = periodEl.value;
    var novoContrato = {
      id: 'ct_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
      fornecedorNome: cf.fornecedorNome, fornecedorCodigo: cf.fornecedorCodigo,
      escopo: escopoEl.value.trim(), precoBase: parseNum(precoEl.value),
      indice: indiceEl.value, periodicidade: periodicidade, dataInicio: dataEl.value,
      proximoReajuste: addMonths(dataEl.value, PERIODICIDADES[periodicidade][1]),
      status: 'ativo', obs: obsEl2.value, criadoEm: new Date().toISOString(), obraId: cf.obraId || null,
      anexo: UI.contratos.anexoDraft || null
    };
    STATE.contratos.unshift(novoContrato);
    logAtividade('Contrato registrado', titleCase(novoContrato.fornecedorNome)+' — '+novoContrato.escopo);
    UI.contratos.showForm = false; UI.contratos.anexoDraft = null; persist('Contrato registrado.'); render(); return;
  }
  if((el = e.target.closest('[data-renovar-contrato]'))){
    var rcid = el.getAttribute('data-renovar-contrato');
    var ctR = STATE.contratos.find(function(x){return x.id===rcid;});
    if(ctR){ ctR.dataInicio = ctR.proximoReajuste; ctR.proximoReajuste = addMonths(ctR.proximoReajuste, PERIODICIDADES[ctR.periodicidade][1]); logAtividade('Contrato renovado', titleCase(ctR.fornecedorNome)); }
    persist('Contrato renovado.'); render(); return;
  }
  if((el = e.target.closest('[data-encerrar-contrato]'))){
    var ecid = el.getAttribute('data-encerrar-contrato');
    var ctE = STATE.contratos.find(function(x){return x.id===ecid;});
    if(ctE){ ctE.status = 'encerrado'; logAtividade('Contrato encerrado', titleCase(ctE.fornecedorNome)); }
    persist('Contrato encerrado.'); render(); return;
  }
  if((el = e.target.closest('[data-contrato-filtro]'))){ UI.contratos.filtro = el.getAttribute('data-contrato-filtro'); render(); return; }

  /* Obras */
  if(e.target.id==='btn-abrir-obra'){ UI.obras.showForm = true; UI.obras.form = { nome:'', cliente:'', status:'ativa' }; render(); return; }
  if(e.target.id==='btn-cancelar-obra'){ UI.obras.showForm = false; render(); return; }
  if(e.target.id==='btn-salvar-obra'){
    var of = UI.obras.form;
    if(!of.nome || !of.nome.trim()){ toast('Informe o nome da obra.', true); return; }
    var novaObra = { id:'obra_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7), nome:of.nome.trim(), cliente:(of.cliente||'').trim(), status: of.status||'ativa', criadoEm: new Date().toISOString() };
    STATE.obras.unshift(novaObra);
    logAtividade('Obra cadastrada', novaObra.nome);
    UI.obras.showForm=false; persist('Obra cadastrada.'); render(); return;
  }
  if((el = e.target.closest('[data-concluir-obra]'))){
    var ocid = el.getAttribute('data-concluir-obra'); var obC = getObra(ocid);
    if(obC){ obC.status = 'concluida'; logAtividade('Obra concluída', obC.nome); }
    persist('Obra marcada como concluída.'); render(); return;
  }
  if((el = e.target.closest('[data-reabrir-obra]'))){
    var orid = el.getAttribute('data-reabrir-obra'); var obR = getObra(orid);
    if(obR){ obR.status = 'ativa'; logAtividade('Obra reaberta', obR.nome); }
    persist('Obra reaberta.'); render(); return;
  }

  /* Pedidos de compra + recebimento */
  if((el = e.target.closest('[data-pedido-filtro]'))){ UI.pedidos.filtro = el.getAttribute('data-pedido-filtro'); UI.pedidos.limit=60; render(); return; }
  if(e.target.id==='btn-pedidos-mais'){ UI.pedidos.limit += 60; render(); return; }
  if((el = e.target.closest('[data-abrir-recebimento]'))){
    var pedIdAbrir = el.getAttribute('data-abrir-recebimento');
    UI.pedidos.recebimentoAbertoId = pedIdAbrir;
    UI.pedidos.recebimentoDraft = { data: todayISO(), qtd:'', notaFiscal:'', problemaQualidade:false, obs:'', anexo:null };
    render(); return;
  }
  if(e.target.id==='btn-cancelar-recebimento'){ UI.pedidos.recebimentoAbertoId = null; render(); return; }
  if((el = e.target.closest('[data-salvar-recebimento]'))){
    var pedIdSalvar = el.getAttribute('data-salvar-recebimento');
    var pedObj = STATE.pedidos.find(function(x){return x.id===pedIdSalvar;});
    var dataEl2 = document.getElementById('input-recebimento-data');
    var qtdEl2 = document.getElementById('input-recebimento-qtd');
    var nfEl2 = document.getElementById('input-recebimento-nf');
    var probEl2 = document.getElementById('chk-recebimento-problema');
    var obsEl3 = document.getElementById('textarea-recebimento-obs');
    var qtdRec = parseNum(qtdEl2 ? qtdEl2.value : '0');
    if(!dataEl2 || !dataEl2.value){ toast('Informe a data do recebimento.', true); return; }
    if(!qtdRec || qtdRec<=0){ toast('Informe a quantidade recebida.', true); return; }
    if(pedObj){
      pedObj.recebimentos.push({
        data: dataEl2.value, quantidade: qtdRec, notaFiscal: nfEl2 ? nfEl2.value.trim() : '',
        problemaQualidade: probEl2 ? probEl2.checked : false, obs: obsEl3 ? obsEl3.value.trim() : '',
        anexo: UI.pedidos.recebimentoDraft.anexo || null
      });
      logAtividade('Recebimento registrado', pedObj.numero+' — '+num1(qtdRec)+' '+(pedObj.unidade||'un.'));
    }
    UI.pedidos.recebimentoAbertoId = null;
    persist('Recebimento registrado.'); render(); return;
  }
  if((el = e.target.closest('[data-cancelar-pedido]'))){
    var pedIdCancel = el.getAttribute('data-cancelar-pedido');
    var pedCancel = STATE.pedidos.find(function(x){return x.id===pedIdCancel;});
    if(pedCancel){ pedCancel.cancelado = true; logAtividade('Pedido de compra cancelado', pedCancel.numero); }
    persist('Pedido cancelado.'); render(); return;
  }

  /* Segunda fonte (itens estratégicos com fornecedor único) */
  if((el = e.target.closest('[data-abrir-segunda-fonte]'))){
    var sfKey = el.getAttribute('data-abrir-segunda-fonte');
    var existingSf = STATE.segundaFonte[sfKey];
    UI.segundaFonte.editingId = sfKey;
    UI.segundaFonte.draft = existingSf ? Object.assign({status:'buscando',fornecedorAlternativo:'',obs:''}, existingSf) : { status:'buscando', fornecedorAlternativo:'', obs:'' };
    render(); return;
  }
  if(e.target.id==='btn-cancelar-segunda-fonte'){ UI.segundaFonte.editingId = null; render(); return; }
  if((el = e.target.closest('[data-salvar-segunda-fonte]'))){
    var sfKeySave = el.getAttribute('data-salvar-segunda-fonte');
    var statusSelSf = document.getElementById('select-segunda-fonte-status');
    var fornAltEl = document.getElementById('input-segunda-fonte-fornecedor');
    var obsSfEl = document.getElementById('textarea-segunda-fonte-obs');
    STATE.segundaFonte[sfKeySave] = {
      status: statusSelSf ? statusSelSf.value : 'buscando',
      fornecedorAlternativo: fornAltEl ? fornAltEl.value.trim() : '',
      obs: obsSfEl ? obsSfEl.value.trim() : ''
    };
    logAtividade('Segunda fonte atualizada', sfKeySave);
    UI.segundaFonte.editingId = null;
    persist('Segunda fonte registrada.'); render(); return;
  }

  /* Exportar dados brutos (CSV) */
  if(e.target.id==='btn-abrir-csv-export'){ UI.csvExport.showModal = true; render(); return; }
  if(e.target.id==='csv-export-backdrop' || e.target.closest('[data-close-csv-export]')){ UI.csvExport.showModal = false; render(); return; }
  if((el = e.target.closest('[data-csv-dataset]'))){ UI.csvExport.dataset = el.getAttribute('data-csv-dataset'); render(); return; }
  if(e.target.id==='btn-selecionar-csv'){
    var ta = document.getElementById('csv-export-textarea');
    if(ta){ ta.focus(); ta.select(); }
    return;
  }


  /* Agendamento de Compras (Kanban) */
  /* ---------- Mapa Comparativo ---------- */
  if((el = e.target.closest('[data-cmp-aba]'))){
    UI.comparativo.aba = el.getAttribute('data-cmp-aba');
    UI.comparativo.novoFornecedor = false;
    UI.comparativo.novoProdutoPara = null; UI.comparativo.novoProdutoFoto = null;
    UI.comparativo.pendingDelete = null;
    render(); return;
  }
  if(e.target.closest('#btn-cmp-novo-fornecedor')){
    UI.comparativo.novoFornecedor = true; render();
    var inpNF = document.getElementById('input-cmp-novo-fornecedor'); if(inpNF) inpNF.focus();
    return;
  }
  if(e.target.closest('#btn-cmp-cancelar-fornecedor')){
    UI.comparativo.novoFornecedor = false; render(); return;
  }
  if(e.target.closest('#btn-cmp-confirmar-fornecedor')){ cmpCriarFornecedor(); return; }

  if((el = e.target.closest('[data-cmp-excluir-forn]'))){
    UI.comparativo.pendingDelete = 'forn:'+el.getAttribute('data-cmp-excluir-forn'); render(); return;
  }
  if((el = e.target.closest('[data-cmp-excluir-forn-sim]'))){
    var fidDel = el.getAttribute('data-cmp-excluir-forn-sim');
    var fDel = cmpFornecedorPorId(fidDel);
    STATE.comparativo.fornecedores = STATE.comparativo.fornecedores.filter(function(f){ return f.id!==fidDel; });
    delete STATE.comparativo.produtos[fidDel];
    Object.keys(STATE.comparativo.selecionados).forEach(function(k){ if(k.indexOf(fidDel+'|')===0) delete STATE.comparativo.selecionados[k]; });
    UI.comparativo.pendingDelete = null;
    if(UI.comparativo.aba===fidDel) UI.comparativo.aba = null;
    logAtividade('Proposta removida do mapa comparativo', fDel ? cmpNomeFornecedor(fDel) : '');
    persist('Proposta excluída.'); render(); return;
  }
  if(e.target.closest('[data-cmp-cancelar-exclusao]')){
    UI.comparativo.pendingDelete = null; render(); return;
  }

  if((el = e.target.closest('[data-cmp-abrir-novo-produto]'))){
    UI.comparativo.novoProdutoPara = el.getAttribute('data-cmp-abrir-novo-produto');
    UI.comparativo.novoProdutoFoto = null;
    render();
    var inpNP = document.getElementById('input-cmp-np-nome'); if(inpNP) inpNP.focus();
    return;
  }
  if(e.target.closest('#btn-cmp-cancelar-novo-produto')){
    UI.comparativo.novoProdutoPara = null; UI.comparativo.novoProdutoFoto = null; render(); return;
  }
  if((el = e.target.closest('[data-cmp-salvar-novo-produto]'))){
    cmpSalvarNovoProduto(el.getAttribute('data-cmp-salvar-novo-produto')); return;
  }

  if((el = e.target.closest('[data-cmp-excluir-prod]'))){
    var pk = el.getAttribute('data-cmp-excluir-prod').split('|');
    UI.comparativo.pendingDelete = 'prod:'+pk[0]+':'+pk[1]; render(); return;
  }
  if((el = e.target.closest('[data-cmp-excluir-prod-sim]'))){
    var chaveDel = el.getAttribute('data-cmp-excluir-prod-sim');
    var pdk = chaveDel.split('|');
    var prodDel = cmpProdutoPorId(pdk[0], pdk[1]);
    STATE.comparativo.produtos[pdk[0]] = cmpProdutosDe(pdk[0]).filter(function(p){ return p.id!==pdk[1]; });
    delete STATE.comparativo.selecionados[chaveDel];
    UI.comparativo.pendingDelete = null;
    if(UI.comparativo.detalhe && UI.comparativo.detalhe.pid===pdk[1]) UI.comparativo.detalhe = null;
    logAtividade('Item removido de uma proposta', prodDel ? cmpNomeProduto(prodDel) : '');
    persist('Item excluído.'); render(); return;
  }

  if((el = e.target.closest('[data-cmp-toggle]'))){
    var chaveT = el.getAttribute('data-cmp-toggle');
    if(STATE.comparativo.selecionados[chaveT]) delete STATE.comparativo.selecionados[chaveT];
    else STATE.comparativo.selecionados[chaveT] = true;
    UI.comparativo.escolha = null;
    persist('Comparativo atualizado.'); render(); return;
  }
  if((el = e.target.closest('[data-cmp-tirar]'))){
    delete STATE.comparativo.selecionados[el.getAttribute('data-cmp-tirar')];
    UI.comparativo.escolha = null;
    persist('Comparativo atualizado.'); render(); return;
  }
  if((el = e.target.closest('[data-cmp-picker-toggle]'))){
    var fidPk = el.getAttribute('data-cmp-picker-toggle');
    UI.comparativo.pickerOpen[fidPk] = UI.comparativo.pickerOpen[fidPk]===false ? true : false;
    render(); return;
  }

  if((el = e.target.closest('[data-cmp-ver-produto]'))){
    var kv = el.getAttribute('data-cmp-ver-produto').split('|');
    UI.comparativo.detalhe = { fid:kv[0], pid:kv[1] }; render(); return;
  }
  if(e.target.closest('[data-cmp-fechar-detalhe]') || e.target.id==='cmp-detalhe-backdrop'){
    UI.comparativo.detalhe = null; render(); return;
  }
  if((el = e.target.closest('[data-cmp-remover-foto]'))){
    var kf = el.getAttribute('data-cmp-remover-foto').split('|');
    var prodF = cmpProdutoPorId(kf[0], kf[1]);
    if(prodF){ prodF.foto = null; persist('Foto removida.'); render(); }
    return;
  }
  if((el = e.target.closest('[data-cmp-baixar-anexo]'))){
    var fBx = cmpFornecedorPorId(el.getAttribute('data-cmp-baixar-anexo'));
    if(fBx && fBx.anexo) cmpBaixarAnexo(fBx.anexo.nome, fBx.anexo.dataUrl);
    else toast('Anexo não encontrado.', true);
    return;
  }
  if((el = e.target.closest('[data-cmp-remover-anexo]'))){
    var fAnx = cmpFornecedorPorId(el.getAttribute('data-cmp-remover-anexo'));
    if(fAnx){ fAnx.anexo = null; persist('Anexo removido.'); render(); }
    return;
  }

  if(e.target.closest('#btn-cmp-concluir')){ cmpConcluirComparacao(true); return; }
  if(e.target.closest('#btn-cmp-imprimir')){
    cmpImprimir(cmpComPontuacao(cmpItensSelecionados()), cmpEscolhaAtual()); return;
  }
  if(e.target.closest('#btn-cmp-exportar-csv')){
    UI.csvExport.dataset = 'comparativo'; UI.csvExport.showModal = true; render(); return;
  }

  if((el = e.target.closest('[data-cmp-hist-toggle]'))){
    var hid = el.getAttribute('data-cmp-hist-toggle');
    UI.comparativo.historicoOpen[hid] = !UI.comparativo.historicoOpen[hid];
    render(); return;
  }
  if((el = e.target.closest('[data-cmp-hist-imprimir]'))){
    var hImp = STATE.comparativo.historico.find(function(h){ return h.id===el.getAttribute('data-cmp-hist-imprimir'); });
    if(hImp){ var rec = cmpItensDoHistorico(hImp); cmpImprimir(rec.itens, rec.chaveEscolhida); }
    return;
  }
  if((el = e.target.closest('[data-cmp-hist-excluir]'))){
    if(!isAdmin()){ toast('Somente um administrador pode excluir um registro do histórico.', true); return; }
    var hDelId = el.getAttribute('data-cmp-hist-excluir');
    STATE.comparativo.historico = STATE.comparativo.historico.filter(function(h){ return h.id!==hDelId; });
    logAtividade('Registro de comparação excluído', '');
    persist('Registro excluído.'); render(); return;
  }
  if((el = e.target.closest('[data-cmp-hist-agendar]'))){
    if(!isAdmin()){ toast('Somente um administrador pode criar um card de compra.', true); return; }
    var hAg = STATE.comparativo.historico.find(function(h){ return h.id===el.getAttribute('data-cmp-hist-agendar'); });
    if(!hAg) return;
    var venc = (hAg.itens||[]).find(function(i){ return i.escolhido; }) || (hAg.itens||[])[0];
    if(!venc){ toast('Esta comparação não tem um item vencedor registrado.', true); return; }
    UI.agendamento.form = blankAgendamentoForm();
    UI.agendamento.form.produto = venc.produtoNome || '';
    UI.agendamento.form.quantidade = venc.qtd ? String(venc.qtd) : '';
    UI.agendamento.form.unidade = venc.unidade || 'un';
    UI.agendamento.form.fornecedor = venc.fornecedorNome || '';
    UI.agendamento.form.foto = venc.foto || null;
    UI.agendamento.form.explicacao = 'Vencedor do mapa comparativo de ' + dateBR(String(hAg.criadoEm).slice(0,10))
      + ' — ' + moneyCents(venc.total) + ' entre ' + (hAg.itens||[]).length + ' proposta(s).'
      + (hAg.justificativa ? ' Justificativa: ' + hAg.justificativa : '');
    UI.agendamento.editingId = null;
    UI.agendamento.showForm = true;
    UI.tab = 'agendamento';
    toast('Card pré-preenchido com o vencedor — escolha o operador responsável e salve.');
    render(); return;
  }

  if(e.target.id==='btn-novo-agendamento'){
    if(!isAdmin()){ toast('Somente um administrador pode criar um card.', true); return; }
    UI.agendamento.showForm = true; UI.agendamento.editingId = null; UI.agendamento.form = blankAgendamentoForm();
    render(); return;
  }
  if(e.target.id==='agendamento-modal-backdrop' || e.target.closest('[data-close-agendamento]')){
    UI.agendamento.showForm = false; UI.agendamento.editingId = null; UI.agendamento.form = blankAgendamentoForm();
    render(); return;
  }
  if((el = e.target.closest('[data-editar-agendamento]'))){
    if(!isAdmin()) return;
    var eaId = el.getAttribute('data-editar-agendamento');
    var eaCard = STATE.agendamentos.find(function(x){ return x.id===eaId; });
    if(!eaCard) return;
    UI.agendamento.editingId = eaId;
    UI.agendamento.form = {
      foto: eaCard.foto||null, fotoNome: eaCard.fotoNome||'', produto: eaCard.produto||'',
      quantidade: eaCard.quantidade!=null ? String(eaCard.quantidade) : '', unidade: eaCard.unidade||'un',
      fornecedor: eaCard.fornecedor||'', explicacao: eaCard.explicacao||'', responsavelUserId: eaCard.responsavelUserId||''
    };
    UI.agendamento.showForm = true;
    render(); return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-clear-agendamento-foto')){
    UI.agendamento.form.foto = null; UI.agendamento.form.fotoNome = '';
    render(); return;
  }
  if(e.target.id==='btn-salvar-agendamento'){
    if(!isAdmin()){ toast('Somente um administrador pode salvar este card.', true); return; }
    var af = UI.agendamento.form;
    var afProdutoEl = document.getElementById('input-agendamento-produto');
    var afQtdEl = document.getElementById('input-agendamento-quantidade');
    var afUnidadeEl = document.getElementById('input-agendamento-unidade');
    var afFornecedorEl = document.getElementById('input-agendamento-fornecedor');
    var afExplicacaoEl = document.getElementById('textarea-agendamento-explicacao');
    var afResponsavelEl = document.getElementById('select-agendamento-responsavel');
    af.produto = afProdutoEl ? afProdutoEl.value.trim() : af.produto;
    af.quantidade = afQtdEl ? afQtdEl.value.trim() : af.quantidade;
    af.unidade = afUnidadeEl ? afUnidadeEl.value.trim() : af.unidade;
    af.fornecedor = afFornecedorEl ? afFornecedorEl.value.trim() : af.fornecedor;
    af.explicacao = afExplicacaoEl ? afExplicacaoEl.value.trim() : af.explicacao;
    af.responsavelUserId = afResponsavelEl ? afResponsavelEl.value : af.responsavelUserId;

    if(!af.produto){ toast('Informe o produto.', true); return; }
    var qtdNum = parseNum(af.quantidade);
    if(!qtdNum || qtdNum<=0){ toast('Informe uma quantidade válida.', true); return; }
    if(!af.explicacao){ toast('Informe a explicação (quem pediu / para que serve).', true); return; }
    if(!af.responsavelUserId){ toast('Selecione o operador responsável.', true); return; }
    var respUser = STATE.usuarios.find(function(x){ return x.id===af.responsavelUserId; });
    if(!respUser){ toast('Operador selecionado não encontrado.', true); return; }

    if(UI.agendamento.editingId){
      var editCard = STATE.agendamentos.find(function(x){ return x.id===UI.agendamento.editingId; });
      if(editCard){
        editCard.foto = af.foto||null; editCard.fotoNome = af.fotoNome||'';
        editCard.produto = af.produto; editCard.quantidade = qtdNum; editCard.unidade = af.unidade||'un';
        editCard.fornecedor = af.fornecedor||''; editCard.explicacao = af.explicacao;
        editCard.responsavelUserId = respUser.id; editCard.responsavelNome = respUser.nomeCompleto;
        logAtividade('Card de compra editado', editCard.produto);
      }
    } else {
      var novoCard = {
        id: 'agd_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
        criadoEm: new Date().toISOString(),
        foto: af.foto||null, fotoNome: af.fotoNome||'',
        produto: af.produto, quantidade: qtdNum, unidade: af.unidade||'un',
        fornecedor: af.fornecedor||'', explicacao: af.explicacao,
        responsavelUserId: respUser.id, responsavelNome: respUser.nomeCompleto,
        status: 'pendente',
        criadoPorUserId: currentUsuario() ? currentUsuario().id : null,
        concluidoEm: null
      };
      STATE.agendamentos.push(novoCard);
      logAtividade('Card de compra criado', novoCard.produto+' → '+novoCard.responsavelNome);
    }
    UI.agendamento.showForm = false; UI.agendamento.editingId = null; UI.agendamento.form = blankAgendamentoForm();
    persist('Card salvo.'); render(); return;
  }
  if((el = e.target.closest('[data-agendamento-set-status]'))){
    var agId = el.getAttribute('data-agendamento-id');
    var novoStatusAg = el.getAttribute('data-agendamento-set-status');
    var agCard = STATE.agendamentos.find(function(x){ return x.id===agId; });
    if(!agCard) return;
    var meAg = currentUsuario();
    var souResponsavelAg = meAg && agCard.responsavelUserId===meAg.id;
    if(!isAdmin() && !souResponsavelAg){ toast('Você não pode alterar este card.', true); return; }
    if(!isAdmin()){
      var ordemAg = { pendente:0, comprando:1, comprado:2 };
      if(ordemAg[novoStatusAg] !== ordemAg[agCard.status]+1){ toast('Você só pode avançar o card para a próxima etapa.', true); return; }
    }
    agCard.status = novoStatusAg;
    agCard.concluidoEm = novoStatusAg==='comprado' ? new Date().toISOString() : null;
    logAtividade('Status do card de compra alterado', agCard.produto+' → '+novoStatusAg);
    persist('Status atualizado.'); render(); return;
  }
  if((el = e.target.closest('[data-toggle-explicacao-agendamento]'))){
    var teId = el.getAttribute('data-toggle-explicacao-agendamento');
    UI.agendamento.expandedIds[teId] = !UI.agendamento.expandedIds[teId];
    render(); return;
  }
  if((el = e.target.closest('[data-excluir-agendamento]'))){
    if(!isAdmin()) return;
    UI.agendamento.pendingDeleteId = el.getAttribute('data-excluir-agendamento');
    render(); return;
  }
  if((el = e.target.closest('[data-cancelar-excluir-agendamento]'))){
    UI.agendamento.pendingDeleteId = null;
    render(); return;
  }
  if((el = e.target.closest('[data-confirmar-excluir-agendamento]'))){
    if(!isAdmin()) return;
    var delId = el.getAttribute('data-confirmar-excluir-agendamento');
    var delCard = STATE.agendamentos.find(function(x){ return x.id===delId; });
    STATE.agendamentos = STATE.agendamentos.filter(function(x){ return x.id!==delId; });
    UI.agendamento.pendingDeleteId = null;
    if(delCard) logAtividade('Card de compra excluído', delCard.produto);
    persist('Card excluído.'); render(); return;
  }

  /* Hora Extra */
  if(e.target.id==='btn-he-add-pessoa'){
    UI.horaExtra.form.pessoas.push({nome:'', horario:'15:00'});
    render(); return;
  }
  if((el = e.target.closest('[data-he-remove-pessoa]'))){
    var rpIdx = parseInt(el.getAttribute('data-he-remove-pessoa'),10);
    if(UI.horaExtra.form.pessoas.length>1){ UI.horaExtra.form.pessoas.splice(rpIdx,1); render(); }
    return;
  }
  if((el = e.target.closest('[data-he-horario-idx]'))){
    var hIdx = parseInt(el.getAttribute('data-he-horario-idx'),10);
    var hVal = el.getAttribute('data-he-horario-valor');
    var hp = heNormPessoa(UI.horaExtra.form.pessoas[hIdx]);
    hp.horario = (hVal==='12:00') ? '12:00' : '15:00';
    UI.horaExtra.form.pessoas[hIdx] = hp;
    render(); return;
  }
  if(e.target.id==='btn-enviar-hora-extra'){
    var hf = UI.horaExtra.form;
    var hfSetorEl = document.getElementById('input-he-setor');
    var hfRespEl = document.getElementById('input-he-responsavel');
    var hfObsEl = document.getElementById('textarea-he-obs');
    hf.setor = hfSetorEl ? hfSetorEl.value.trim() : hf.setor;
    hf.responsavelSolicitante = hfRespEl ? hfRespEl.value.trim() : hf.responsavelSolicitante;
    hf.observacao = hfObsEl ? hfObsEl.value.trim() : hf.observacao;
    var pessoasLimpa = heFilledPessoas(hf.pessoas);

    if(!hf.setor){ toast('Informe o setor.', true); return; }
    if(!hf.responsavelSolicitante){ toast('Informe o responsável pela solicitação.', true); return; }
    if(!pessoasLimpa.length){ toast('Informe ao menos uma pessoa em hora extra.', true); return; }
    var contagem = heCounts(pessoasLimpa);

    var novoHe = {
      id: 'he_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      criadoEm: new Date().toISOString(),
      setor: hf.setor, responsavelSolicitante: hf.responsavelSolicitante,
      pessoas: pessoasLimpa, qtdLanches: contagem.lanches, qtdMarmitas: contagem.marmitas,
      observacao: hf.observacao||'',
      criadoPorUserId: currentUsuario() ? currentUsuario().id : null,
      status: 'pendente'
    };
    STATE.horaExtra.push(novoHe);
    logAtividade('Pedido de hora extra registrado', novoHe.setor+' — '+contagem.lanches+' lanche(s), '+contagem.marmitas+' marmita(s)');
    UI.horaExtra.form = blankHoraExtraForm();
    persist('Pedido de hora extra enviado.'); render(); return;
  }
  if((el = e.target.closest('[data-he-filtro]'))){
    UI.horaExtra.filtroStatus = el.getAttribute('data-he-filtro');
    render(); return;
  }
  if((el = e.target.closest('[data-he-toggle-status]'))){
    if(isChefeSetor()) return;
    var heId = el.getAttribute('data-he-toggle-status');
    var heItem = STATE.horaExtra.find(function(x){ return x.id===heId; });
    if(!heItem) return;
    heItem.status = heItem.status==='comprado' ? 'pendente' : 'comprado';
    logAtividade('Status de pedido de hora extra alterado', heItem.setor+' → '+heItem.status);
    persist('Status atualizado.'); render(); return;
  }
});

/* ============================================================
   Event delegation: input / change
   ============================================================ */
document.addEventListener('input', function(e){
  function keepCaret(id){
    var inp = document.getElementById(id);
    if(inp){ var pos = inp.value.length; inp.focus(); inp.setSelectionRange(pos,pos); }
  }
  if(e.target.id==='input-fornecedor-search'){ UI.fornecedores.search = e.target.value; UI.fornecedores.limit=60; render(); keepCaret('input-fornecedor-search'); return; }
  if(e.target.id==='input-item-search'){ UI.itens.search = e.target.value; UI.itens.limit=60; render(); keepCaret('input-item-search'); return; }
  if(e.target.id==='input-reposicao-search'){ UI.reposicao.search = e.target.value; UI.reposicao.limit=60; render(); keepCaret('input-reposicao-search'); return; }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cotacao-item-search')){
    var siIdx = parseInt(e.target.getAttribute('data-item-idx'),10);
    UI.cotacoes.formItensCotados[siIdx].itemBusca = e.target.value;
    UI.cotacoes.formItensCotados[siIdx].itemSel = null;
    UI.cotacoes.formItensCotados[siIdx].dismissSuggestions = false;
    render();
    var reEl = document.querySelector('[data-cotacao-item-search][data-item-idx="'+siIdx+'"]');
    if(reEl){ var posE = reEl.value.length; reEl.focus(); reEl.setSelectionRange(posE,posE); }
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cotacao-qtd')){
    var qIdx = parseInt(e.target.getAttribute('data-item-idx'),10);
    UI.cotacoes.formItensCotados[qIdx].qtd = e.target.value;
    render();
    var reQ = document.querySelector('[data-cotacao-qtd][data-item-idx="'+qIdx+'"]');
    if(reQ){ var posQ = reQ.value.length; reQ.focus(); reQ.setSelectionRange(posQ,posQ); }
    return;
  }
  if(e.target.id==='input-contrato-fornecedor'){ UI.contratos.form.fornecedorBusca = e.target.value; UI.contratos.form.fornecedorNome=''; render(); keepCaret('input-contrato-fornecedor'); return; }
  if(e.target.hasAttribute && e.target.hasAttribute('data-quote-field')){
    var qItemIdx = parseInt(e.target.getAttribute('data-item-idx'),10);
    var idx = parseInt(e.target.getAttribute('data-quote-idx'),10);
    var field = e.target.getAttribute('data-quote-field');
    UI.cotacoes.formItensCotados[qItemIdx].linhas[idx][field] = e.target.value;
    if(field==='preco'){
      render();
      var refocus = document.querySelector('[data-quote-field="preco"][data-item-idx="'+qItemIdx+'"][data-quote-idx="'+idx+'"]');
      if(refocus){ var pos = refocus.value.length; refocus.focus(); refocus.setSelectionRange(pos,pos); }
    }
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cotacao-unidade')){
    var uIdx = parseInt(e.target.getAttribute('data-item-idx'),10);
    UI.cotacoes.formItensCotados[uIdx].unidade = e.target.value;
    return;
  }
  if(e.target.id==='input-cotacao-solicitante'){ UI.cotacoes.formSolicitante = e.target.value; return; }
  if(e.target.id==='input-cotacao-setor'){ UI.cotacoes.formSetor = e.target.value; return; }
  if(e.target.id==='textarea-cotacao-obs'){ UI.cotacoes.formObs = e.target.value; return; }
  if(e.target.id==='textarea-fornecedor-obs'){ return; }
  if(e.target.id==='input-contrato-escopo'){ UI.contratos.form.escopo = e.target.value; return; }
  if(e.target.id==='input-contrato-preco'){ UI.contratos.form.precoBase = e.target.value; return; }
  if(e.target.id==='textarea-contrato-obs'){ UI.contratos.form.obs = e.target.value; return; }
  if(e.target.id==='input-contrato-data'){ UI.contratos.form.dataInicio = e.target.value; render(); return; }
  if(e.target.hasAttribute && e.target.hasAttribute('data-toggle-reposicao')){
    var rcod = e.target.getAttribute('data-toggle-reposicao');
    STATE.pontosPedido[rcod] = { ativo: e.target.checked };
    persist('Preferência de reposição salva.');
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-estoque-input')){
    var ecod = e.target.getAttribute('data-estoque-input');
    UI.reposicao.estoqueDraft[ecod] = e.target.value;
    return;
  }
  if(e.target.id==='input-obra-nome'){ UI.obras.form.nome = e.target.value; return; }
  if(e.target.id==='input-obra-cliente'){ UI.obras.form.cliente = e.target.value; return; }
  if(e.target.id==='input-cotacao-exception-just'){ UI.cotacoes.exceptionText = e.target.value; return; }
  if(e.target.id==='input-cotacao-reject-just'){ UI.cotacoes.rejectText = e.target.value; return; }
  if(e.target.id==='input-novo-codigo-admin'){ UI.usuarios.novoCodigoAdmin = e.target.value; return; }
  if(e.target.id==='input-empresa-nome'){ return; }
  if(e.target.id==='input-recebimento-data'){ UI.pedidos.recebimentoDraft.data = e.target.value; return; }
  if(e.target.id==='input-recebimento-qtd'){ UI.pedidos.recebimentoDraft.qtd = e.target.value; return; }
  if(e.target.id==='input-recebimento-nf'){ UI.pedidos.recebimentoDraft.notaFiscal = e.target.value; return; }
  if(e.target.id==='textarea-recebimento-obs'){ UI.pedidos.recebimentoDraft.obs = e.target.value; return; }
  if(e.target.id==='input-segunda-fonte-fornecedor'){ UI.segundaFonte.draft.fornecedorAlternativo = e.target.value; return; }
  if(e.target.id==='textarea-segunda-fonte-obs'){ UI.segundaFonte.draft.obs = e.target.value; return; }
  if(e.target.id==='input-agendamento-produto'){ UI.agendamento.form.produto = e.target.value; return; }
  if(e.target.id==='input-agendamento-quantidade'){ UI.agendamento.form.quantidade = e.target.value; return; }
  if(e.target.id==='input-agendamento-unidade'){ UI.agendamento.form.unidade = e.target.value; return; }
  if(e.target.id==='input-agendamento-fornecedor'){ UI.agendamento.form.fornecedor = e.target.value; return; }
  if(e.target.id==='textarea-agendamento-explicacao'){ UI.agendamento.form.explicacao = e.target.value; return; }
  if(e.target.id==='textarea-cmp-justificativa'){ UI.comparativo.justificativa = e.target.value; return; }
  /* Enquanto o item novo é digitado, mostra o valor da linha já calculado, na mesma coluna
     em que ele vai aparecer depois de salvo. */
  if(e.target.id && e.target.id.indexOf('input-cmp-np-')===0){ cmpAtualizarPreviaNovoItem(); return; }
  if(e.target.id==='input-he-setor'){ UI.horaExtra.form.setor = e.target.value; return; }
  if(e.target.id==='input-he-responsavel'){ UI.horaExtra.form.responsavelSolicitante = e.target.value; return; }
  if(e.target.id==='textarea-he-obs'){ UI.horaExtra.form.observacao = e.target.value; return; }
  if(e.target.hasAttribute && e.target.hasAttribute('data-he-pessoa-idx')){
    var hpIdx = parseInt(e.target.getAttribute('data-he-pessoa-idx'),10);
    var hpAtual = heNormPessoa(UI.horaExtra.form.pessoas[hpIdx]);
    hpAtual.nome = e.target.value;
    UI.horaExtra.form.pessoas[hpIdx] = hpAtual;
    /* Não chama render(): o resumo de lanches/marmitas só precisa refletir
       nomes preenchidos no momento do próximo clique/render, e um render aqui
       tiraria o foco do campo de nome a cada tecla digitada. */
    return;
  }
});

document.addEventListener('change', function(e){
  if(e.target.hasAttribute && e.target.hasAttribute('data-quote-foto')){
    var fileQ = e.target.files && e.target.files[0];
    if(!fileQ) return;
    if(fileQ.size > 900*1024){ toast('Escolha uma imagem menor (até ~900KB).', true); return; }
    var qfItemIdx = parseInt(e.target.getAttribute('data-item-idx'),10);
    var qfLineIdx = parseInt(e.target.getAttribute('data-quote-idx'),10);
    var readerQ = new FileReader();
    readerQ.onload = function(ev){
      var linhaAlvo = UI.cotacoes.formItensCotados[qfItemIdx] && UI.cotacoes.formItensCotados[qfItemIdx].linhas[qfLineIdx];
      if(!linhaAlvo) return;
      linhaAlvo.foto = ev.target.result; linhaAlvo.fotoNome = fileQ.name;
      render();
    };
    readerQ.readAsDataURL(fileQ);
    return;
  }
  if(e.target.id==='input-logo-upload'){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    if(file.size > 900*1024){ toast('Escolha uma imagem menor (até ~900KB).', true); return; }
    var reader = new FileReader();
    reader.onload = function(ev){
      STATE.branding.logoDataUrl = ev.target.result;
      logAtividade('Logo da empresa atualizada', '');
      persist('Logo atualizada.'); render();
    };
    reader.readAsDataURL(file);
    return;
  }
  if(e.target.id==='select-contrato-indice'){ UI.contratos.form.indice = e.target.value; render(); return; }
  if(e.target.id==='select-contrato-periodicidade'){ UI.contratos.form.periodicidade = e.target.value; render(); return; }
  if(e.target.id==='select-contrato-obra'){ UI.contratos.form.obraId = e.target.value; return; }
  if(e.target.id==='select-cotacao-obra'){ UI.cotacoes.formObraId = e.target.value; return; }
  if(e.target.id==='select-obra-status'){ UI.obras.form.status = e.target.value; return; }
  if(e.target.hasAttribute && e.target.hasAttribute('data-estoque-input')){
    var scod = e.target.getAttribute('data-estoque-input');
    var v = parseNum(e.target.value);
    if(!e.target.value || v<=0){
      delete STATE.estoqueAtual[scod];
    } else {
      STATE.estoqueAtual[scod] = { qtd: v, atualizadoEm: todayISO() };
    }
    delete UI.reposicao.estoqueDraft[scod];
    logAtividade('Estoque atual informado', scod+' — '+(v>0?num1(v):'removido'));
    persist('Estoque atualizado.'); render(); return;
  }
  if(e.target.id==='chk-recebimento-problema'){ UI.pedidos.recebimentoDraft.problemaQualidade = e.target.checked; return; }
  if(e.target.id==='input-recebimento-anexo'){
    var fileR = e.target.files && e.target.files[0];
    if(!fileR) return;
    if(fileR.size > 700*1024){ toast('Escolha um arquivo menor (até ~700KB).', true); return; }
    var readerR = new FileReader();
    readerR.onload = function(ev){
      UI.pedidos.recebimentoDraft.anexo = { nome: fileR.name, dataUrl: ev.target.result };
      render();
    };
    readerR.readAsDataURL(fileR);
    return;
  }
  if(e.target.id==='input-fornecedor-anexo'){
    var fileF = e.target.files && e.target.files[0];
    if(!fileF) return;
    if(fileF.size > 700*1024){ toast('Escolha um arquivo menor (até ~700KB).', true); return; }
    var readerF = new FileReader();
    readerF.onload = function(ev){
      var codAtual = UI.editingFornecedor;
      var curAvF = getAvaliacao(codAtual);
      STATE.avaliacoes[codAtual] = Object.assign({}, curAvF, { certificadoAnexo: { nome: fileF.name, dataUrl: ev.target.result } });
      logAtividade('Documento anexado ao cadastro do fornecedor', fileF.name);
      persist('Documento anexado.'); render();
    };
    readerF.readAsDataURL(fileF);
    return;
  }
  if(e.target.id==='input-contrato-anexo'){
    var fileC = e.target.files && e.target.files[0];
    if(!fileC) return;
    if(fileC.size > 700*1024){ toast('Escolha um arquivo menor (até ~700KB).', true); return; }
    var readerC = new FileReader();
    readerC.onload = function(ev){
      UI.contratos.anexoDraft = { nome: fileC.name, dataUrl: ev.target.result };
      render();
    };
    readerC.readAsDataURL(fileC);
    return;
  }
  /* ---------- Mapa Comparativo ----------
     Campos editados direto na tabela gravam no `change` (que dispara ao sair do campo) e
     NÃO redesenham a tela: um render() aqui roubaria o foco a cada campo preenchido e,
     entre o mousedown e o click, poderia trocar o próprio botão que a pessoa está
     clicando — fazendo o clique "sumir". Só os números derivados são reescritos. */
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-prod-campo')){
    var campoP = e.target.getAttribute('data-cmp-prod-campo');
    var chaveP = e.target.getAttribute('data-cmp-alvo');
    var kp = chaveP.split('|');
    var prodP = cmpProdutoPorId(kp[0], kp[1]);
    if(!prodP) return;
    var valP = e.target.value;
    if(campoP==='qtd'||campoP==='precoUnit'||campoP==='descontoPct'||campoP==='frete'||campoP==='moq') valP = cmpNum(valP);
    prodP[campoP] = valP;
    cmpAtualizarTotaisNaTela(kp[0], chaveP);
    cmpSalvarDepois('Item atualizado.');
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-forn-campo')){
    var campoF = e.target.getAttribute('data-cmp-forn-campo');
    var fidF = e.target.getAttribute('data-cmp-fid');
    var fF = cmpFornecedorPorId(fidF);
    if(!fF) return;
    var valF = e.target.value;
    if(campoF==='nome' && !String(valF).trim()){ e.target.value = fF.nome; return; }
    if(campoF==='prazoDias'||campoF==='pagamentoDias') valF = (valF==='' ? '' : cmpNum(valF));
    fF[campoF] = valF;
    if(campoF==='nome'){
      var lblAba = document.querySelector('[data-cmp-aba="'+fidF+'"] .cmp-tab-label');
      if(lblAba) lblAba.textContent = titleCase(valF);
    }
    /* Data de validade e status mudam selos visíveis em vários lugares da tela, e são
       escolhidos num seletor (não digitados) — aqui o redesenho é seguro e necessário. */
    if(campoF==='validadeProposta' || campoF==='status'){ persist('Proposta atualizada.'); render(); return; }
    cmpSalvarDepois('Proposta atualizada.');
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-unidade-select')){
    var chaveU = e.target.getAttribute('data-cmp-alvo');
    var ku = chaveU.split('|');
    var outroInp = e.target.parentNode ? e.target.parentNode.querySelector('[data-cmp-unidade-outra]') : null;
    if(e.target.value==='__outra__'){
      if(outroInp){ outroInp.style.display=''; outroInp.focus(); }
      return;
    }
    if(outroInp){ outroInp.style.display='none'; outroInp.value=''; }
    var prodU = cmpProdutoPorId(ku[0], ku[1]);
    if(prodU){ prodU.unidade = e.target.value; cmpAtualizarTotaisNaTela(ku[0], chaveU); cmpSalvarDepois('Item atualizado.'); }
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-unidade-outra')){
    var chaveUo = e.target.getAttribute('data-cmp-alvo');
    var kuo = chaveUo.split('|');
    var prodUo = cmpProdutoPorId(kuo[0], kuo[1]);
    if(prodUo){ prodUo.unidade = e.target.value.trim(); cmpAtualizarTotaisNaTela(kuo[0], chaveUo); cmpSalvarDepois('Item atualizado.'); }
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-foto-produto')){
    var fileCmp = e.target.files && e.target.files[0];
    if(!fileCmp) return;
    var kft = e.target.getAttribute('data-cmp-foto-produto').split('|');
    cmpComprimirImagem(fileCmp).then(function(dataUrl){
      var prodFt = cmpProdutoPorId(kft[0], kft[1]);
      if(!prodFt) return;
      prodFt.foto = dataUrl;
      persist('Foto salva.'); render();
    }).catch(function(){ toast('Não foi possível ler esta imagem.', true); });
    return;
  }
  if(e.target.id==='input-cmp-novo-produto-foto'){
    var fileNP = e.target.files && e.target.files[0];
    if(!fileNP) return;
    var inputNP = e.target;
    cmpComprimirImagem(fileNP).then(function(dataUrl){
      UI.comparativo.novoProdutoFoto = { dataUrl: dataUrl, nome: fileNP.name };
      /* Troca só a miniatura, sem redesenhar: os outros campos da linha de novo item são
         digitados livremente e não ficam guardados no estado, então um render() aqui
         apagaria tudo que a pessoa escreveu antes de anexar a foto. */
      var lblFt = inputNP.closest('.cmp-thumb-btn');
      if(lblFt){
        lblFt.classList.remove('empty');
        lblFt.innerHTML = '<img src="'+dataUrl+'" alt="Foto do item">';
        lblFt.appendChild(inputNP);
      } else { render(); }
    }).catch(function(){ toast('Não foi possível ler esta imagem.', true); });
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-anexo')){
    var fileAx = e.target.files && e.target.files[0];
    if(!fileAx) return;
    if(fileAx.size > CMP_MAX_ANEXO){ toast('Escolha um arquivo menor (até ~900KB) — todo anexo é salvo junto com o painel.', true); return; }
    var fidAx = e.target.getAttribute('data-cmp-anexo');
    var readerAx = new FileReader();
    readerAx.onload = function(ev){
      var fAx = cmpFornecedorPorId(fidAx);
      if(!fAx) return;
      fAx.anexo = { nome: fileAx.name, dataUrl: ev.target.result, tipo: fileAx.type||'' };
      persist('Orçamento anexado.'); render();
    };
    readerAx.onerror = function(){ toast('Não foi possível ler o arquivo.', true); };
    readerAx.readAsDataURL(fileAx);
    return;
  }
  if(e.target.hasAttribute && e.target.hasAttribute('data-cmp-picker')){
    var chavePk = e.target.getAttribute('data-cmp-picker');
    if(e.target.checked) STATE.comparativo.selecionados[chavePk] = true;
    else delete STATE.comparativo.selecionados[chavePk];
    UI.comparativo.escolha = null;
    persist('Comparativo atualizado.'); render(); return;
  }
  if(e.target.id==='select-cmp-escolha'){ UI.comparativo.escolha = e.target.value; render(); return; }
  if(e.target.id==='select-cmp-np-unidade'){
    var outraNP = document.getElementById('input-cmp-np-unidade-outra');
    if(e.target.value==='__outra__'){ if(outraNP){ outraNP.style.display=''; outraNP.focus(); } }
    else if(outraNP){ outraNP.style.display='none'; outraNP.value=''; }
    cmpAtualizarPreviaNovoItem();
    return;
  }
  if(e.target.id==='select-cmp-copiar-item'){
    var kc = (e.target.value||'').split('|');
    var origem = kc.length===2 ? cmpProdutoPorId(kc[0], kc[1]) : null;
    e.target.value = '';
    if(!origem) return;
    /* Copia só a descrição do item (nome, marca, especificação, unidade e quantidade).
       Preço, desconto e frete são justamente o que muda de um fornecedor para outro e
       nunca são copiados. */
    function setCmpVal(id, val){ var elc = document.getElementById(id); if(elc) elc.value = (val==null?'':val); }
    setCmpVal('input-cmp-np-nome', origem.nome);
    setCmpVal('input-cmp-np-marca', origem.marca);
    setCmpVal('input-cmp-np-spec', origem.spec);
    setCmpVal('input-cmp-np-qtd', cmpNum(origem.qtd) || '');
    var selUnC = document.getElementById('select-cmp-np-unidade');
    var outraC = document.getElementById('input-cmp-np-unidade-outra');
    if(selUnC){
      if(cmpUnidadeConhecida(origem.unidade)){
        selUnC.value = String(origem.unidade||'').trim().toUpperCase();
        if(outraC){ outraC.style.display='none'; outraC.value=''; }
      } else {
        selUnC.value = '__outra__';
        if(outraC){ outraC.style.display=''; outraC.value = origem.unidade||''; }
      }
    }
    cmpAtualizarPreviaNovoItem();
    var focoC = document.getElementById('input-cmp-np-preco'); if(focoC) focoC.focus();
    return;
  }
  if(e.target.id==='select-csv-dataset'){ UI.csvExport.dataset = e.target.value; render(); return; }
  if(e.target.id==='select-agendamento-responsavel'){ UI.agendamento.form.responsavelUserId = e.target.value; return; }
  if(e.target.hasAttribute && e.target.hasAttribute('data-agendamento-foto')){
    var fileAg = e.target.files && e.target.files[0];
    if(!fileAg) return;
    if(fileAg.size > 900*1024){ toast('Escolha uma imagem menor (até ~900KB).', true); return; }
    var readerAg = new FileReader();
    readerAg.onload = function(ev){
      UI.agendamento.form.foto = ev.target.result; UI.agendamento.form.fotoNome = fileAg.name;
      render();
    };
    readerAg.readAsDataURL(fileAg);
    return;
  }
});

/* Atalhos de teclado da aba Mapa Comparativo. Preencher proposta é trabalho de teclado:
   Enter confirma o que a pessoa acabou de escrever e Esc desiste, sem obrigar a pegar o
   mouse a cada campo. */
document.addEventListener('keydown', function(e){
  var alvo = e.target;
  if(!alvo) return;

  if(e.key==='Escape'){
    if(UI.comparativo.detalhe){ UI.comparativo.detalhe = null; render(); return; }
    if(UI.comparativo.novoProdutoPara){
      UI.comparativo.novoProdutoPara = null; UI.comparativo.novoProdutoFoto = null; render(); return;
    }
    if(UI.comparativo.novoFornecedor){ UI.comparativo.novoFornecedor = false; render(); return; }
    if(UI.comparativo.pendingDelete){ UI.comparativo.pendingDelete = null; render(); return; }
    return;
  }

  if(e.key!=='Enter') return;

  /* Nome da proposta nova, na barra de abas */
  if(alvo.id==='input-cmp-novo-fornecedor'){ e.preventDefault(); cmpCriarFornecedor(); return; }

  /* Qualquer campo da linha de item novo salva o item — inclusive os seletores. */
  if(UI.comparativo.novoProdutoPara && alvo.closest && alvo.closest('.cmp-add-row')){
    e.preventDefault(); cmpSalvarNovoProduto(UI.comparativo.novoProdutoPara); return;
  }

  /* Campos já salvos (tabela de itens e ficha do fornecedor): Enter confirma o campo,
     gravando o valor e saindo dele. Em textarea, Enter continua servindo para quebrar
     linha — ali a confirmação acontece ao sair do campo. */
  if(alvo.tagName!=='TEXTAREA' && alvo.hasAttribute &&
     (alvo.hasAttribute('data-cmp-prod-campo') || alvo.hasAttribute('data-cmp-forn-campo') ||
      alvo.hasAttribute('data-cmp-unidade-outra'))){
    e.preventDefault(); alvo.blur(); return;
  }
});

document.addEventListener('mousemove', function(e){
  var svg = document.getElementById('scatter-svg');
  var tip = document.getElementById('scatter-tooltip');
  if(!svg || !tip) return;
  var target = e.target;
  if(target && target.tagName==='circle' && target.hasAttribute('data-pt-codigo')){
    var codigo = target.getAttribute('data-pt-codigo');
    var p = produtosAtivos().find(function(x){ return itemAggKey(x)===codigo; });
    if(!p) return;
    tip.innerHTML = '<strong>'+esc(titleCase(p.descricao))+'</strong><br>'+money(p.spend)+' · '+p.nFornecedores+' fornecedor(es) · '+p.nPedidos+' pedidos';
    var wrap = svg.closest('.scatter-wrap');
    var wrapRect = wrap.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX - wrapRect.left + 12, wrapRect.width - 230) + 'px';
    tip.style.top = Math.max(e.clientY - wrapRect.top - 40, 0) + 'px';
  } else if(tip.style.display==='block' && (!target || target.tagName!=='circle')){
    tip.style.display = 'none';
  }
});

/* Test/debug hook: exposes internal state to automated Playwright tests running against
   this file. Harmless in normal use — nothing in the UI reads or depends on this. */
window.__appDebug = { STATE: STATE, UI: UI, gerarLembretesDiarios: gerarLembretesDiarios, render: render, currentUsuario: currentUsuario };

render();

})();
