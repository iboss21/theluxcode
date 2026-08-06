/**
 * The service registry: every repo and runtime the command center fronts.
 *
 * Transcribed from REPOS.md, which is the authority on what exists. Ports are
 * the ones the services are actually bound to locally, and `probe` is the path
 * that answers cheaply when the service is up - a health route where one
 * exists, otherwise the root document. Nothing here starts or stops anything;
 * the dashboard only ever observes.
 *
 * `kind` drives how the UI groups a service, and `docker` marks the ones that
 * cannot come up until Docker is installed, so a red dot on those reads as
 * "not installed yet" rather than "broken".
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const SERVICES = [
  // -- The command center and its own parts ------------------------------
  { id: 'regescore', name: 'RegesCore', kind: 'core', port: 3000, probe: '/api/system/stats',
    repo: 'https://github.com/iboss21/reges.core-memory',
    what: 'Central AI command center: server, dashboard, memory vault, knowledge graph, sessions, agent chat' },
  { id: 'luxcode', name: 'LUXCode', kind: 'core', port: 5173, probe: '/',
    repo: 'https://github.com/iboss21/LUXCode',
    what: 'Local AI vibe-coding studio: agent, OmniRoute gateway, MCP, 20+ LLM providers' },

  // -- Engines -----------------------------------------------------------
  { id: 'lmstudio', name: 'LM Studio', kind: 'engine', port: 2126, probe: '/v1/models',
    what: 'Local LLM server, currently serving claude-fable-5.0-rg35bmoe' },
  { id: 'odysseus', name: 'Odysseus', kind: 'engine', port: 7000, probe: '/',
    repo: 'https://github.com/pewdiepie-archdaemon/odysseus',
    what: 'Autonomous AI workspace: chats, memory, RAG, email, calendar, tools' },
  { id: 'voicebox', name: 'Voicebox', kind: 'engine', port: 8000, probe: '/profiles',
    repo: 'https://github.com/jamiepine/voicebox',
    what: 'Voice studio: cloning, 7 TTS engines, Whisper STT, DSP, profiles' },
  { id: 'voiceserver', name: 'Voice Server', kind: 'engine', port: 17493, probe: '/profiles',
    what: 'edge-tts voice server: /speak, /profiles, /transcribe' },
  { id: 'acestep', name: 'ACE-Step', kind: 'engine', port: 8001, probe: '/',
    repo: 'https://github.com/lxxue/ace-step',
    what: 'Music diffusion: text to music, remix, repaint, LoRA' },
  { id: 'acestep-ui', name: 'ACE-Step UI', kind: 'engine', port: 7860, probe: '/',
    what: 'Gradio front end for ACE-Step' },

  // -- Armory: automation and AI -----------------------------------------
  { id: 'n8n', name: 'n8n', kind: 'armory', port: 5678, probe: '/healthz',
    repo: 'https://github.com/n8n-io/n8n',
    what: 'Workflow automation: triggers, actions, integrations, webhooks' },
  { id: 'agentmemory', name: 'AgentMemory', kind: 'armory', port: 3111, probe: '/',
    repo: 'https://github.com/iii-hq/iii',
    what: 'AI memory and vector server: telemetry, facts, vector search' },
  { id: 'agentmemory-ui', name: 'AgentMemory Viewer', kind: 'armory', port: 3114, probe: '/',
    what: 'Viewer UI for AgentMemory' },
  { id: 'sia', name: 'SIA', kind: 'armory', port: 18080, probe: '/',
    repo: 'https://github.com/hexo-ai/sia',
    what: 'Self-improving AI benchmark agent with run visualizer' },
  { id: 'excalidraw', name: 'Excalidraw', kind: 'armory', port: 3018, probe: '/',
    repo: 'https://github.com/excalidraw/excalidraw',
    what: 'Whiteboard: diagrams, collaboration' },
  { id: 'openwebui', name: 'Open WebUI', kind: 'armory', port: 3010, probe: '/',
    repo: 'https://github.com/open-webui/open-webui',
    what: 'Web chat UI for local LLMs' },
  { id: 'activepieces', name: 'Activepieces', kind: 'armory', port: 8080, probe: '/', docker: true,
    repo: 'https://github.com/activepieces/activepieces',
    what: 'Visual automation builder, 1000+ integrations' },
  { id: 'agentcompany', name: 'Agent Company', kind: 'armory', port: 18081, probe: '/', docker: true,
    repo: 'https://github.com/TheAgentCompany/TheAgentCompany',
    what: 'Autonomous agent team runner' },
  { id: 'aicallagent', name: 'AI Call Agent', kind: 'armory', port: 5050, probe: '/',
    repo: 'https://github.com/rehan-dev/ai-call-agent',
    what: 'Twilio + OpenAI Realtime phone agent' },

  // -- Armory: business apps, all Docker ---------------------------------
  { id: 'twenty', name: 'Twenty CRM', kind: 'business', port: 3011, probe: '/', docker: true,
    repo: 'https://github.com/twentyhq/twenty-crm', what: 'CRM: contacts, deals, pipelines' },
  { id: 'outline', name: 'Outline', kind: 'business', port: 3012, probe: '/', docker: true,
    repo: 'https://github.com/outline/outline', what: 'Team wiki: docs, collections' },
  { id: 'chatwoot', name: 'Chatwoot', kind: 'business', port: 3013, probe: '/', docker: true,
    repo: 'https://github.com/chatwoot/chatwoot', what: 'Support inbox: conversations, agents' },
  { id: 'docuseal', name: 'DocuSeal', kind: 'business', port: 3014, probe: '/', docker: true,
    repo: 'https://github.com/docusealco/docuseal', what: 'E-signatures: quotes, contracts' },
  { id: 'formbricks', name: 'Formbricks', kind: 'business', port: 3015, probe: '/', docker: true,
    repo: 'https://github.com/formbricks/formbricks', what: 'Surveys and user feedback' },
  { id: 'caldiy', name: 'Cal.diy', kind: 'business', port: 3016, probe: '/', docker: true,
    repo: 'https://github.com/calcom/cal.diy', what: 'Scheduling and booking' },
  { id: 'usesend', name: 'UseSend', kind: 'business', port: 3017, probe: '/', docker: true,
    repo: 'https://github.com/usesend/usesend', what: 'Email marketing and newsletters' },
  { id: 'kimai', name: 'Kimai', kind: 'business', port: 3019, probe: '/', docker: true,
    repo: 'https://github.com/kimai/kimai', what: 'Time tracking, invoices from time logs' },
  { id: 'nextcloud', name: 'Nextcloud', kind: 'business', port: 8091, probe: '/status.php', docker: true,
    repo: 'https://github.com/nextcloud/server', what: 'Cloud file sync, share, storage' },
  { id: 'creditfix', name: 'CreditFixExpert', kind: 'business', port: 5000, probe: '/',
    what: 'creditfixexpert.com: React/Vite + Express/Drizzle/Postgres, AI dispute letters, Stripe' },
]

const BY_ID = new Map(SERVICES.map((s) => [s.id, s]))

// Host is configurable because the dashboard may run on a different box than
// the services; a single override keeps every probe pointing at the same place.
function baseUrl(service, host = process.env.REGESCORE_SERVICE_HOST || '127.0.0.1') {
  return `http://${host}:${service.port}`
}

function probeUrl(service, host) {
  return baseUrl(service, host) + (service.probe || '/')
}

module.exports = { SERVICES, BY_ID, baseUrl, probeUrl }
