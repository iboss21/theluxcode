/**
 * Armory tool registry + Docker orchestrator. The admin panel launches these
 * open-source tools as containers on your Docker host (VPS) and shows their
 * live state. Dependency-free Docker Engine API client over the unix socket.
 * With no Docker socket (e.g. shared hosting) the catalog still lists; launch
 * controls activate on a Docker host.
 */
const http = require('http')
const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'

/** name, category, replaces, docker image, internal port, env, volumes, deps. */
const REGISTRY = [
  // CRM & Sales
  { slug: 'twenty', name: 'Twenty', category: 'CRM & Sales', replaces: 'Salesforce', image: 'twentycrm/twenty:latest', port: 3000, needs: ['postgres', 'redis'] },
  { slug: 'espocrm', name: 'EspoCRM', category: 'CRM & Sales', replaces: 'HubSpot', image: 'espocrm/espocrm:latest', port: 80, needs: ['mysql'] },
  { slug: 'suitecrm', name: 'SuiteCRM', category: 'CRM & Sales', replaces: 'Salesforce', image: 'bitnami/suitecrm:latest', port: 8080, needs: ['mysql'] },
  { slug: 'krayin', name: 'Krayin', category: 'CRM & Sales', replaces: 'Zoho CRM', image: 'webkul/krayincrm:latest', port: 80, needs: ['mysql'] },
  { slug: 'monica', name: 'Monica', category: 'CRM & Sales', replaces: 'personal CRM', image: 'monica:latest', port: 80, needs: ['mysql'], volumes: ['monica_data:/var/www/html/storage'] },
  // Marketing & Email
  { slug: 'mautic', name: 'Mautic', category: 'Marketing & Email', replaces: 'HubSpot Marketing', image: 'mautic/mautic:5-apache', port: 80, needs: ['mysql'] },
  { slug: 'listmonk', name: 'Listmonk', category: 'Marketing & Email', replaces: 'Mailchimp', image: 'listmonk/listmonk:latest', port: 9000, needs: ['postgres'] },
  { slug: 'keila', name: 'Keila', category: 'Marketing & Email', replaces: 'Mailchimp', image: 'pentacent/keila:latest', port: 4000, needs: ['postgres'] },
  { slug: 'mailu', name: 'Mailu', category: 'Marketing & Email', replaces: 'Google Workspace mail', image: 'ghcr.io/mailu/admin:2024.06', port: 80, note: 'Full mail server suite.' },
  { slug: 'docker-mailserver', name: 'docker-mailserver', category: 'Marketing & Email', replaces: 'hosted email', image: 'mailserver/docker-mailserver:latest', port: 25, volumes: ['mail_data:/var/mail'], note: 'Production mail server.' },
  // Support & Inbox
  { slug: 'chatwoot', name: 'Chatwoot', category: 'Support & Inbox', replaces: 'Intercom · Zendesk', image: 'chatwoot/chatwoot:latest', port: 3000, needs: ['postgres', 'redis'] },
  { slug: 'zammad', name: 'Zammad', category: 'Support & Inbox', replaces: 'Zendesk', image: 'zammad/zammad:latest', port: 8080, needs: ['postgres', 'redis'] },
  { slug: 'freescout', name: 'FreeScout', category: 'Support & Inbox', replaces: 'Help Scout', image: 'tiredofit/freescout:latest', port: 8080, needs: ['mysql'] },
  { slug: 'osticket', name: 'osTicket', category: 'Support & Inbox', replaces: 'Zendesk', image: 'campbellsoftwaresolutions/osticket:latest', port: 80, needs: ['mysql'] },
  { slug: 'tiledesk', name: 'Tiledesk', category: 'Support & Inbox', replaces: 'Intercom', image: 'tiledesk/tiledesk-server:latest', port: 3000, needs: ['mongo'], note: 'Live chat + chatbots.' },
  // Forms & Surveys
  { slug: 'formbricks', name: 'Formbricks', category: 'Forms & Surveys', replaces: 'Typeform', image: 'ghcr.io/formbricks/formbricks:latest', port: 3000, needs: ['postgres'] },
  { slug: 'opnform', name: 'OpnForm', category: 'Forms & Surveys', replaces: 'Typeform · Google Forms', image: 'jhumanj/opnform:latest', port: 80, needs: ['postgres'] },
  { slug: 'limesurvey', name: 'LimeSurvey', category: 'Forms & Surveys', replaces: 'Qualtrics · SurveyMonkey', image: 'martialblog/limesurvey:latest', port: 8080, needs: ['mysql'] },
  { slug: 'heyform', name: 'HeyForm', category: 'Forms & Surveys', replaces: 'Typeform', image: 'heyform/community-edition:latest', port: 8000, needs: ['mongo', 'redis'] },
  // Scheduling & Booking
  { slug: 'cal', name: 'Cal.com', category: 'Scheduling & Booking', replaces: 'Calendly', image: 'calcom/cal.com:latest', port: 3000, needs: ['postgres'] },
  { slug: 'easyappointments', name: 'Easy!Appointments', category: 'Scheduling & Booking', replaces: 'Acuity', image: 'alextselegidis/easyappointments:latest', port: 80, needs: ['mysql'] },
  { slug: 'rallly', name: 'Rallly', category: 'Scheduling & Booking', replaces: 'Doodle', image: 'lukevella/rallly:latest', port: 3000, needs: ['postgres'], note: 'Group scheduling polls.' },
  // Docs & E-Sign
  { slug: 'docuseal', name: 'DocuSeal', category: 'Docs & E-Sign', replaces: 'DocuSign', image: 'docuseal/docuseal:latest', port: 3000, volumes: ['docuseal_data:/data'] },
  { slug: 'documenso', name: 'Documenso', category: 'Docs & E-Sign', replaces: 'DocuSign · PandaDoc', image: 'documenso/documenso:latest', port: 3000, needs: ['postgres'] },
  { slug: 'opensign', name: 'OpenSign', category: 'Docs & E-Sign', replaces: 'DocuSign', image: 'opensign/opensign:latest', port: 3000, needs: ['mongo'] },
  // Invoicing & Accounting
  { slug: 'invoiceninja', name: 'Invoice Ninja', category: 'Invoicing & Accounting', replaces: 'QuickBooks', image: 'invoiceninja/invoiceninja:5', port: 80, needs: ['mysql'] },
  { slug: 'crater', name: 'Crater', category: 'Invoicing & Accounting', replaces: 'FreshBooks', image: 'crater/crater:latest', port: 80, needs: ['mysql'] },
  { slug: 'invoiceplane', name: 'InvoicePlane', category: 'Invoicing & Accounting', replaces: 'QuickBooks', image: 'librenms/invoiceplane:latest', port: 80, needs: ['mysql'] },
  { slug: 'akaunting', name: 'Akaunting', category: 'Invoicing & Accounting', replaces: 'QuickBooks · Xero', image: 'akaunting/akaunting:latest', port: 80, needs: ['mysql'] },
  { slug: 'firefly', name: 'Firefly III', category: 'Invoicing & Accounting', replaces: 'Mint · YNAB', image: 'fireflyiii/core:latest', port: 8080, needs: ['mysql'], note: 'Personal/business finance.' },
  { slug: 'kimai', name: 'Kimai', category: 'Invoicing & Accounting', replaces: 'Harvest · Toggl', image: 'kimai/kimai2:apache', port: 8001, needs: ['mysql'], note: 'Time tracking.' },
  { slug: 'actual', name: 'Actual Budget', category: 'Invoicing & Accounting', replaces: 'YNAB', image: 'actualbudget/actual-server:latest', port: 5006, volumes: ['actual_data:/data'] },
  // Analytics & BI
  { slug: 'plausible', name: 'Plausible', category: 'Analytics & BI', replaces: 'Google Analytics', image: 'ghcr.io/plausible/community-edition:v3', port: 8000, needs: ['postgres', 'clickhouse'] },
  { slug: 'umami', name: 'Umami', category: 'Analytics & BI', replaces: 'Google Analytics', image: 'ghcr.io/umami-software/umami:postgresql-latest', port: 3000, needs: ['postgres'] },
  { slug: 'matomo', name: 'Matomo', category: 'Analytics & BI', replaces: 'Google Analytics', image: 'matomo:latest', port: 80, needs: ['mysql'] },
  { slug: 'posthog', name: 'PostHog', category: 'Analytics & BI', replaces: 'Mixpanel · Amplitude', image: 'posthog/posthog:latest', port: 8000, needs: ['postgres', 'redis', 'clickhouse'] },
  { slug: 'metabase', name: 'Metabase', category: 'Analytics & BI', replaces: 'Looker · Tableau', image: 'metabase/metabase:latest', port: 3000, volumes: ['metabase_data:/metabase-data'], env: { MB_DB_FILE: '/metabase-data/metabase.db' } },
  { slug: 'superset', name: 'Apache Superset', category: 'Analytics & BI', replaces: 'Tableau · Power BI', image: 'apache/superset:latest', port: 8088, needs: ['postgres', 'redis'] },
  { slug: 'redash', name: 'Redash', category: 'Analytics & BI', replaces: 'Mode · Looker', image: 'redash/redash:latest', port: 5000, needs: ['postgres', 'redis'] },
  // Automation & AI
  { slug: 'n8n', name: 'n8n', category: 'Automation & AI', replaces: 'Zapier · Make', image: 'n8nio/n8n:latest', port: 5678, env: { N8N_SECURE_COOKIE: 'false' }, volumes: ['n8n_data:/home/node/.n8n'] },
  { slug: 'activepieces', name: 'Activepieces', category: 'Automation & AI', replaces: 'Zapier', image: 'activepieces/activepieces:latest', port: 80, needs: ['postgres', 'redis'] },
  { slug: 'windmill', name: 'Windmill', category: 'Automation & AI', replaces: 'Retool · Airplane', image: 'ghcr.io/windmill-labs/windmill:main', port: 8000, needs: ['postgres'] },
  { slug: 'nodered', name: 'Node-RED', category: 'Automation & AI', replaces: 'Zapier', image: 'nodered/node-red:latest', port: 1880, volumes: ['nodered_data:/data'] },
  { slug: 'huginn', name: 'Huginn', category: 'Automation & AI', replaces: 'IFTTT', image: 'huginn/huginn:latest', port: 3000, needs: ['mysql'] },
  { slug: 'dify', name: 'Dify', category: 'Automation & AI', replaces: 'OpenAI Assistants', image: 'langgenius/dify-api:latest', port: 5001, needs: ['postgres', 'redis'] },
  { slug: 'flowise', name: 'Flowise', category: 'Automation & AI', replaces: 'LangChain UI', image: 'flowiseai/flowise:latest', port: 3000, volumes: ['flowise_data:/root/.flowise'] },
  // Local AI & LLM
  { slug: 'ollama', name: 'Ollama', category: 'Local AI & LLM', replaces: 'OpenAI API', image: 'ollama/ollama:latest', port: 11434, volumes: ['ollama_data:/root/.ollama'] },
  { slug: 'open-webui', name: 'Open WebUI', category: 'Local AI & LLM', replaces: 'ChatGPT Team', image: 'ghcr.io/open-webui/open-webui:main', port: 8080, volumes: ['openwebui_data:/app/backend/data'] },
  { slug: 'librechat', name: 'LibreChat', category: 'Local AI & LLM', replaces: 'ChatGPT · Poe', image: 'ghcr.io/danny-avila/librechat:latest', port: 3080, needs: ['mongo'] },
  { slug: 'anythingllm', name: 'AnythingLLM', category: 'Local AI & LLM', replaces: 'NotebookLM', image: 'mintplexlabs/anythingllm:latest', port: 3001, volumes: ['anythingllm_data:/app/server/storage'] },
  { slug: 'localai', name: 'LocalAI', category: 'Local AI & LLM', replaces: 'OpenAI API', image: 'localai/localai:latest', port: 8080, volumes: ['localai_models:/models'] },
  { slug: 'litellm', name: 'LiteLLM', category: 'Local AI & LLM', replaces: 'OpenAI proxy', image: 'ghcr.io/berriai/litellm:main-latest', port: 4000, note: 'One API across LLM providers.' },
  { slug: 'vllm', name: 'vLLM', category: 'Local AI & LLM', replaces: 'hosted inference', image: 'vllm/vllm-openai:latest', port: 8000, note: 'Needs a GPU host.' },
  // Knowledge & Wiki
  { slug: 'outline', name: 'Outline', category: 'Knowledge & Wiki', replaces: 'Notion · Confluence', image: 'outlinewiki/outline:latest', port: 3000, needs: ['postgres', 'redis'] },
  { slug: 'bookstack', name: 'BookStack', category: 'Knowledge & Wiki', replaces: 'Confluence', image: 'lscr.io/linuxserver/bookstack:latest', port: 80, needs: ['mysql'] },
  { slug: 'wikijs', name: 'Wiki.js', category: 'Knowledge & Wiki', replaces: 'Confluence', image: 'ghcr.io/requarks/wiki:2', port: 3000, needs: ['postgres'] },
  { slug: 'docmost', name: 'Docmost', category: 'Knowledge & Wiki', replaces: 'Notion · Confluence', image: 'docmost/docmost:latest', port: 3000, needs: ['postgres', 'redis'] },
  { slug: 'trilium', name: 'Trilium', category: 'Knowledge & Wiki', replaces: 'Evernote · Notion', image: 'triliumnext/notes:latest', port: 8080, volumes: ['trilium_data:/home/node/trilium-data'] },
  { slug: 'memos', name: 'Memos', category: 'Knowledge & Wiki', replaces: 'Notes · Flomo', image: 'neosmemo/memos:stable', port: 5230, volumes: ['memos_data:/var/opt/memos'] },
  { slug: 'silverbullet', name: 'SilverBullet', category: 'Knowledge & Wiki', replaces: 'Obsidian', image: 'zefhemel/silverbullet:latest', port: 3000, volumes: ['sb_space:/space'] },
  { slug: 'joplin', name: 'Joplin Server', category: 'Knowledge & Wiki', replaces: 'Evernote', image: 'joplin/server:latest', port: 22300, needs: ['postgres'] },
  // Project Management
  { slug: 'plane', name: 'Plane', category: 'Project Management', replaces: 'Jira · Linear', image: 'makeplane/plane-frontend:latest', port: 3000, needs: ['postgres', 'redis'] },
  { slug: 'focalboard', name: 'Focalboard', category: 'Project Management', replaces: 'Trello · Notion', image: 'mattermost/focalboard:latest', port: 8000, volumes: ['focalboard_data:/data'] },
  { slug: 'vikunja', name: 'Vikunja', category: 'Project Management', replaces: 'Todoist · Asana', image: 'vikunja/vikunja:latest', port: 3456, volumes: ['vikunja_files:/app/vikunja/files'] },
  { slug: 'taiga', name: 'Taiga', category: 'Project Management', replaces: 'Jira', image: 'taigaio/taiga-front:latest', port: 80, needs: ['postgres', 'redis'] },
  { slug: 'kanboard', name: 'Kanboard', category: 'Project Management', replaces: 'Trello', image: 'kanboard/kanboard:latest', port: 80, volumes: ['kanboard_data:/var/www/app/data'] },
  { slug: 'wekan', name: 'WeKan', category: 'Project Management', replaces: 'Trello', image: 'wekanteam/wekan:latest', port: 8080, needs: ['mongo'] },
  { slug: 'leantime', name: 'Leantime', category: 'Project Management', replaces: 'Monday.com', image: 'leantime/leantime:latest', port: 80, needs: ['mysql'] },
  { slug: 'openproject', name: 'OpenProject', category: 'Project Management', replaces: 'MS Project · Jira', image: 'openproject/openproject:14', port: 80, needs: ['postgres'] },
  { slug: 'redmine', name: 'Redmine', category: 'Project Management', replaces: 'Jira', image: 'redmine:latest', port: 3000, needs: ['mysql'] },
  // Files & Storage
  { slug: 'nextcloud', name: 'Nextcloud', category: 'Files & Storage', replaces: 'Google Workspace · Dropbox', image: 'nextcloud:latest', port: 80, volumes: ['nextcloud_data:/var/www/html'] },
  { slug: 'seafile', name: 'Seafile', category: 'Files & Storage', replaces: 'Dropbox', image: 'seafileltd/seafile-mc:latest', port: 80, needs: ['mysql'] },
  { slug: 'filebrowser', name: 'File Browser', category: 'Files & Storage', replaces: 'FTP client', image: 'filebrowser/filebrowser:latest', port: 80, volumes: ['fb_data:/srv'] },
  { slug: 'syncthing', name: 'Syncthing', category: 'Files & Storage', replaces: 'Dropbox sync', image: 'syncthing/syncthing:latest', port: 8384, volumes: ['syncthing_data:/var/syncthing'] },
  // Media & Photos
  { slug: 'immich', name: 'Immich', category: 'Media & Photos', replaces: 'Google Photos', image: 'ghcr.io/immich-app/immich-server:release', port: 2283, needs: ['postgres', 'redis'] },
  { slug: 'photoprism', name: 'PhotoPrism', category: 'Media & Photos', replaces: 'Google Photos', image: 'photoprism/photoprism:latest', port: 2342, volumes: ['photoprism_data:/photoprism/storage'] },
  { slug: 'jellyfin', name: 'Jellyfin', category: 'Media & Photos', replaces: 'Plex · Netflix', image: 'jellyfin/jellyfin:latest', port: 8096, volumes: ['jellyfin_config:/config'] },
  { slug: 'navidrome', name: 'Navidrome', category: 'Media & Photos', replaces: 'Spotify', image: 'deluan/navidrome:latest', port: 4533, volumes: ['navidrome_data:/data'], note: 'Self-hosted music.' },
  { slug: 'audiobookshelf', name: 'Audiobookshelf', category: 'Media & Photos', replaces: 'Audible', image: 'ghcr.io/advplyr/audiobookshelf:latest', port: 80, volumes: ['abs_config:/config'] },
  { slug: 'calibreweb', name: 'Calibre-Web', category: 'Media & Photos', replaces: 'Kindle library', image: 'lscr.io/linuxserver/calibre-web:latest', port: 8083, volumes: ['calibre_config:/config'], note: 'E-book library.' },
  // Communication
  { slug: 'rocketchat', name: 'Rocket.Chat', category: 'Communication', replaces: 'Slack', image: 'rocket.chat:latest', port: 3000, needs: ['mongo'] },
  { slug: 'mattermost', name: 'Mattermost', category: 'Communication', replaces: 'Slack', image: 'mattermost/mattermost-team-edition:latest', port: 8065, needs: ['postgres'] },
  { slug: 'zulip', name: 'Zulip', category: 'Communication', replaces: 'Slack', image: 'zulip/docker-zulip:latest', port: 80, needs: ['postgres', 'redis'] },
  { slug: 'jitsi', name: 'Jitsi Meet', category: 'Communication', replaces: 'Zoom · Google Meet', image: 'jitsi/web:stable', port: 443, note: 'Video conferencing.' },
  { slug: 'synapse', name: 'Matrix Synapse', category: 'Communication', replaces: 'Slack · Discord', image: 'matrixdotorg/synapse:latest', port: 8008, needs: ['postgres'], note: 'Federated chat.' },
  // E-commerce
  { slug: 'medusa', name: 'Medusa', category: 'E-commerce', replaces: 'Shopify', image: 'medusajs/medusa:latest', port: 9000, needs: ['postgres', 'redis'] },
  { slug: 'saleor', name: 'Saleor', category: 'E-commerce', replaces: 'Shopify Plus', image: 'ghcr.io/saleor/saleor:latest', port: 8000, needs: ['postgres', 'redis'] },
  { slug: 'bagisto', name: 'Bagisto', category: 'E-commerce', replaces: 'Shopify', image: 'bagisto/bagisto:latest', port: 80, needs: ['mysql'] },
  { slug: 'vendure', name: 'Vendure', category: 'E-commerce', replaces: 'Shopify', image: 'vendure/vendure:latest', port: 3000, needs: ['postgres'] },
  { slug: 'prestashop', name: 'PrestaShop', category: 'E-commerce', replaces: 'Shopify', image: 'prestashop/prestashop:latest', port: 80, needs: ['mysql'] },
  // HR, ERP & Learning
  { slug: 'orangehrm', name: 'OrangeHRM', category: 'HR, ERP & Learning', replaces: 'Bamboo HR', image: 'orangehrm/orangehrm:latest', port: 80, needs: ['mysql'] },
  { slug: 'erpnext', name: 'ERPNext', category: 'HR, ERP & Learning', replaces: 'SAP · NetSuite', image: 'frappe/erpnext:latest', port: 8000, needs: ['mysql', 'redis'], note: 'Full ERP + HR suite.' },
  { slug: 'odoo', name: 'Odoo', category: 'HR, ERP & Learning', replaces: 'SAP · Zoho One', image: 'odoo:latest', port: 8069, needs: ['postgres'], note: 'All-in-one business apps.' },
  { slug: 'moodle', name: 'Moodle', category: 'HR, ERP & Learning', replaces: 'Teachable · Canvas', image: 'bitnami/moodle:latest', port: 80, needs: ['mariadb'], note: 'Learning management (LMS).' },
  // Security & Identity
  { slug: 'vaultwarden', name: 'Vaultwarden', category: 'Security & Identity', replaces: '1Password · LastPass', image: 'vaultwarden/server:latest', port: 80, volumes: ['vaultwarden_data:/data'] },
  { slug: 'authentik', name: 'Authentik', category: 'Security & Identity', replaces: 'Okta · Auth0', image: 'ghcr.io/goauthentik/server:latest', port: 9000, needs: ['postgres', 'redis'] },
  { slug: 'authelia', name: 'Authelia', category: 'Security & Identity', replaces: 'Okta', image: 'authelia/authelia:latest', port: 9091, needs: ['redis'], note: 'SSO + 2FA gateway.' },
  { slug: 'keycloak', name: 'Keycloak', category: 'Security & Identity', replaces: 'Okta · Auth0', image: 'quay.io/keycloak/keycloak:latest', port: 8080, needs: ['postgres'] },
  { slug: 'passbolt', name: 'Passbolt', category: 'Security & Identity', replaces: '1Password Teams', image: 'passbolt/passbolt:latest', port: 80, needs: ['mysql'] },
  // Monitoring & Status
  { slug: 'uptime-kuma', name: 'Uptime Kuma', category: 'Monitoring & Status', replaces: 'UptimeRobot · Pingdom', image: 'louislam/uptime-kuma:1', port: 3001, volumes: ['uptimekuma_data:/app/data'] },
  { slug: 'gatus', name: 'Gatus', category: 'Monitoring & Status', replaces: 'Pingdom', image: 'twinproduction/gatus:latest', port: 8080, volumes: ['gatus_data:/data'] },
  { slug: 'grafana', name: 'Grafana', category: 'Monitoring & Status', replaces: 'Datadog dashboards', image: 'grafana/grafana:latest', port: 3000, volumes: ['grafana_data:/var/lib/grafana'] },
  { slug: 'netdata', name: 'Netdata', category: 'Monitoring & Status', replaces: 'Datadog', image: 'netdata/netdata:latest', port: 19999, note: 'Real-time metrics.' },
  { slug: 'cachet', name: 'Cachet', category: 'Monitoring & Status', replaces: 'Statuspage.io', image: 'cachethq/docker:latest', port: 80, needs: ['postgres'], note: 'Public status page.' },
  // Deploy & Ops
  { slug: 'coolify', name: 'Coolify', category: 'Deploy & Ops', replaces: 'Vercel · Heroku', image: 'ghcr.io/coollabsio/coolify:latest', port: 8000, note: 'Self-hosted PaaS.' },
  { slug: 'portainer', name: 'Portainer', category: 'Deploy & Ops', replaces: 'Docker GUI', image: 'portainer/portainer-ce:latest', port: 9000, volumes: ['portainer_data:/data'] },
  { slug: 'dokploy', name: 'Dokploy', category: 'Deploy & Ops', replaces: 'Vercel · Railway', image: 'dokploy/dokploy:latest', port: 3000, needs: ['postgres', 'redis'] },
  { slug: 'nginxproxymanager', name: 'Nginx Proxy Manager', category: 'Deploy & Ops', replaces: 'Cloudflare tunnel', image: 'jc21/nginx-proxy-manager:latest', port: 81, needs: ['mysql'], note: 'Reverse proxy + SSL GUI.' },
  // Git & DevOps
  { slug: 'gitea', name: 'Gitea', category: 'Git & DevOps', replaces: 'GitHub', image: 'gitea/gitea:latest', port: 3000, volumes: ['gitea_data:/data'] },
  { slug: 'forgejo', name: 'Forgejo', category: 'Git & DevOps', replaces: 'GitHub', image: 'codeberg.org/forgejo/forgejo:9', port: 3000, volumes: ['forgejo_data:/data'] },
  { slug: 'gitlab', name: 'GitLab CE', category: 'Git & DevOps', replaces: 'GitHub Enterprise', image: 'gitlab/gitlab-ce:latest', port: 80, volumes: ['gitlab_data:/var/opt/gitlab'] },
  { slug: 'woodpecker', name: 'Woodpecker CI', category: 'Git & DevOps', replaces: 'CircleCI', image: 'woodpeckerci/woodpecker-server:latest', port: 8000, needs: ['postgres'] },
  { slug: 'drone', name: 'Drone CI', category: 'Git & DevOps', replaces: 'CircleCI', image: 'drone/drone:latest', port: 80, volumes: ['drone_data:/data'] },
  // Search & Data
  { slug: 'meilisearch', name: 'Meilisearch', category: 'Search & Data', replaces: 'Algolia', image: 'getmeili/meilisearch:latest', port: 7700, volumes: ['meili_data:/meili_data'] },
  { slug: 'typesense', name: 'Typesense', category: 'Search & Data', replaces: 'Algolia', image: 'typesense/typesense:latest', port: 8108, volumes: ['typesense_data:/data'] },
  { slug: 'nocodb', name: 'NocoDB', category: 'Search & Data', replaces: 'Airtable', image: 'nocodb/nocodb:latest', port: 8080, volumes: ['nocodb_data:/usr/app/data'] },
  { slug: 'baserow', name: 'Baserow', category: 'Search & Data', replaces: 'Airtable', image: 'baserow/baserow:latest', port: 80, volumes: ['baserow_data:/baserow/data'] },
  { slug: 'directus', name: 'Directus', category: 'Search & Data', replaces: 'Contentful · Airtable', image: 'directus/directus:latest', port: 8055, needs: ['postgres'] },
  { slug: 'appwrite', name: 'Appwrite', category: 'Search & Data', replaces: 'Firebase', image: 'appwrite/appwrite:latest', port: 80, needs: ['mariadb', 'redis'], note: 'Backend-as-a-service.' },
  { slug: 'pocketbase', name: 'PocketBase', category: 'Search & Data', replaces: 'Firebase', image: 'ghcr.io/muchobien/pocketbase:latest', port: 8090, volumes: ['pb_data:/pb_data'] },
  { slug: 'supabase', name: 'Supabase', category: 'Search & Data', replaces: 'Firebase', image: 'supabase/studio:latest', port: 3000, needs: ['postgres'], note: 'Postgres BaaS.' },
  { slug: 'qdrant', name: 'Qdrant', category: 'Search & Data', replaces: 'Pinecone', image: 'qdrant/qdrant:latest', port: 6333, volumes: ['qdrant_data:/qdrant/storage'], note: 'Vector DB for AI.' },
  { slug: 'weaviate', name: 'Weaviate', category: 'Search & Data', replaces: 'Pinecone', image: 'semitechnologies/weaviate:latest', port: 8080, volumes: ['weaviate_data:/var/lib/weaviate'], note: 'Vector DB for AI.' },
  // CMS & Blog
  { slug: 'ghost', name: 'Ghost', category: 'CMS & Blog', replaces: 'Substack · Medium', image: 'ghost:latest', port: 2368, needs: ['mysql'] },
  { slug: 'wordpress', name: 'WordPress', category: 'CMS & Blog', replaces: 'Wix · Squarespace', image: 'wordpress:latest', port: 80, needs: ['mysql'] },
  { slug: 'strapi', name: 'Strapi', category: 'CMS & Blog', replaces: 'Contentful', image: 'strapi/strapi:latest', port: 1337, needs: ['postgres'], note: 'Headless CMS.' },
  { slug: 'payload', name: 'Payload CMS', category: 'CMS & Blog', replaces: 'Contentful', image: 'payloadcms/payload:latest', port: 3000, needs: ['mongo'] },
  // Bookmarks, Feedback & Backup
  { slug: 'linkding', name: 'Linkding', category: 'Bookmarks, Feedback & Backup', replaces: 'Pocket · Raindrop', image: 'sissbruecker/linkding:latest', port: 9090, volumes: ['linkding_data:/etc/linkding/data'] },
  { slug: 'wallabag', name: 'Wallabag', category: 'Bookmarks, Feedback & Backup', replaces: 'Pocket · Instapaper', image: 'wallabag/wallabag:latest', port: 80, needs: ['mysql'] },
  { slug: 'karakeep', name: 'Karakeep', category: 'Bookmarks, Feedback & Backup', replaces: 'Pocket · Pinterest', image: 'ghcr.io/karakeep-app/karakeep:release', port: 3000, needs: ['redis'], note: 'AI bookmarks.' },
  { slug: 'fider', name: 'Fider', category: 'Bookmarks, Feedback & Backup', replaces: 'Canny · UserVoice', image: 'getfider/fider:stable', port: 3000, needs: ['postgres'], note: 'Feature request voting.' },
  { slug: 'duplicati', name: 'Duplicati', category: 'Bookmarks, Feedback & Backup', replaces: 'Backblaze · CrashPlan', image: 'duplicati/duplicati:latest', port: 8200, volumes: ['duplicati_config:/config'] },
  { slug: 'kopia', name: 'Kopia', category: 'Bookmarks, Feedback & Backup', replaces: 'Backblaze', image: 'kopia/kopia:latest', port: 51515, volumes: ['kopia_config:/app/config'] },
  // Dashboards
  { slug: 'homepage', name: 'Homepage', category: 'Dashboards', replaces: 'Start page', image: 'ghcr.io/gethomepage/homepage:latest', port: 3000, volumes: ['homepage_config:/app/config'], note: 'Services dashboard.' },
  { slug: 'homarr', name: 'Homarr', category: 'Dashboards', replaces: 'Start page', image: 'ghcr.io/homarr-labs/homarr:latest', port: 7575, volumes: ['homarr_data:/appdata'] },
]

const containerName = (slug) => 'laki_tool_' + slug
const hostPort = (spec) => 20000 + (spec.port % 10000)
const getTool = (slug) => REGISTRY.find((t) => t.slug === slug)

/* ── Dependency provisioning ────────────────────────────────────────────────
 * Tools that `need` a database don't run without one. The launcher brings up a
 * shared, reusable database/cache container per type on a private network, then
 * wires the tool to it. One Postgres/MySQL/Redis serves every tool that needs it. */
const NETWORK = 'laki_net'
const DEP_SPECS = {
  postgres: { image: 'postgres:16-alpine', env: { POSTGRES_USER: 'laki', POSTGRES_PASSWORD: 'laki', POSTGRES_DB: 'laki' } },
  mysql: { image: 'mysql:8', cmd: ['--default-authentication-plugin=mysql_native_password'], env: { MYSQL_ROOT_PASSWORD: 'laki', MYSQL_DATABASE: 'laki', MYSQL_USER: 'laki', MYSQL_PASSWORD: 'laki' } },
  mariadb: { image: 'mariadb:11', env: { MARIADB_ROOT_PASSWORD: 'laki', MARIADB_DATABASE: 'laki', MARIADB_USER: 'laki', MARIADB_PASSWORD: 'laki' } },
  mongo: { image: 'mongo:7', env: { MONGO_INITDB_ROOT_USERNAME: 'laki', MONGO_INITDB_ROOT_PASSWORD: 'laki' } },
  redis: { image: 'redis:7-alpine', env: {} },
  clickhouse: { image: 'clickhouse/clickhouse-server:latest', env: { CLICKHOUSE_DB: 'laki', CLICKHOUSE_USER: 'laki', CLICKHOUSE_PASSWORD: 'laki' } },
}
const depHost = (type) => 'laki_dep_' + type

/* Spray the connection details across the many env-var conventions real tools use,
 * so a broad set of DB-backed tools connect with no per-tool config. */
function depEnv(needs) {
  const e = {}
  for (const t of needs || []) {
    const h = depHost(t)
    if (t === 'postgres') Object.assign(e, { DB_CONNECTION: 'pgsql', DB_HOST: h, DATABASE_HOST: h, POSTGRES_HOST: h, DB_HOSTNAME: h, PGHOST: h, DB_PORT: '5432', POSTGRES_PORT: '5432', PGPORT: '5432', DB_DATABASE: 'laki', DB_NAME: 'laki', POSTGRES_DB: 'laki', PGDATABASE: 'laki', DB_USERNAME: 'laki', DB_USER: 'laki', POSTGRES_USER: 'laki', PGUSER: 'laki', DB_PASSWORD: 'laki', POSTGRES_PASSWORD: 'laki', PGPASSWORD: 'laki', DATABASE_URL: `postgres://laki:laki@${h}:5432/laki` })
    else if (t === 'mysql' || t === 'mariadb') Object.assign(e, { DB_CONNECTION: 'mysql', DB_HOST: h, DATABASE_HOST: h, MYSQL_HOST: h, DB_HOSTNAME: h, DB_PORT: '3306', MYSQL_PORT: '3306', DB_DATABASE: 'laki', DB_NAME: 'laki', MYSQL_DATABASE: 'laki', DB_USERNAME: 'laki', DB_USER: 'laki', MYSQL_USER: 'laki', DB_PASSWORD: 'laki', MYSQL_PASSWORD: 'laki', DATABASE_URL: `mysql://laki:laki@${h}:3306/laki` })
    else if (t === 'mongo') Object.assign(e, { MONGO_HOST: h, MONGODB_HOST: h, MONGO_URL: `mongodb://laki:laki@${h}:27017`, MONGODB_URI: `mongodb://laki:laki@${h}:27017`, DATABASE_URL: `mongodb://laki:laki@${h}:27017` })
    else if (t === 'redis') Object.assign(e, { REDIS_HOST: h, REDIS_PORT: '6379', REDIS_URL: `redis://${h}:6379` })
    else if (t === 'clickhouse') Object.assign(e, { CLICKHOUSE_HOST: h, CLICKHOUSE_USER: 'laki', CLICKHOUSE_PASSWORD: 'laki' })
  }
  return e
}

/* Tools whose env schema is specific enough to need explicit wiring. */
const PER_TOOL = {
  espocrm: { ESPOCRM_DATABASE_PLATFORM: 'Mysql', ESPOCRM_DATABASE_HOST: depHost('mysql'), ESPOCRM_DATABASE_NAME: 'laki', ESPOCRM_DATABASE_USER: 'laki', ESPOCRM_DATABASE_PASSWORD: 'laki', ESPOCRM_ADMIN_USERNAME: 'admin', ESPOCRM_ADMIN_PASSWORD: 'LikeAKing#2026' },
  invoiceninja: { APP_KEY: 'base64:4ixao5mrOUIhC995q0lsw3gZli5lFnDUcxHJDKlblvg=', APP_URL: 'http://localhost:20080', REQUIRE_HTTPS: 'false', DB_HOST: depHost('mysql'), DB_DATABASE: 'laki', DB_USERNAME: 'laki', DB_PASSWORD: 'laki' },
  n8n: { N8N_SECURE_COOKIE: 'false', N8N_PORT: '5678' },
  ghost: { database__client: 'mysql', database__connection__host: depHost('mysql'), database__connection__user: 'laki', database__connection__password: 'laki', database__connection__database: 'laki' },
}

async function ensureNetwork() {
  const r = await req('POST', '/networks/create', { Name: NETWORK, Driver: 'bridge' })
  return r.status < 400 || r.status === 409
}
async function ensureDep(type) {
  const spec = DEP_SPECS[type]; if (!spec) return true
  const name = depHost(type)
  const ex = await req('GET', `/containers/${name}/json`)
  if (ex.status === 200) { if (!(ex.body.State && ex.body.State.Running)) await req('POST', `/containers/${name}/start`); return true }
  await req('POST', `/images/create?fromImage=${encodeURIComponent(spec.image)}`)
  const cfg = {
    Image: spec.image,
    Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
    Cmd: spec.cmd || undefined,
    Labels: { 'com.likeaking.dep': type, 'com.likeaking.managed': 'true' },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' }, NetworkMode: NETWORK },
  }
  const created = await req('POST', `/containers/create?name=${name}`, cfg)
  if (created.status >= 400 && created.status !== 409) return false
  await req('POST', `/containers/${name}/start`)
  return true
}

function req(method, path, payload) {
  return new Promise((resolve, reject) => {
    const data = payload !== undefined ? JSON.stringify(payload) : undefined
    const r = http.request({ socketPath: SOCKET, path, method, headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        let body = raw
        try { body = raw ? JSON.parse(raw) : null } catch { /* raw */ }
        resolve({ status: res.statusCode || 0, body })
      })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

async function available() {
  try { const r = await req('GET', '/_ping'); return r.status === 200 } catch { return false }
}
async function statusOf(spec) {
  let state = 'not_created', id = null
  try {
    const r = await req('GET', `/containers/${containerName(spec.slug)}/json`)
    if (r.status === 200 && r.body && r.body.State) { state = r.body.State.Running ? 'running' : 'stopped'; id = (r.body.Id || '').slice(0, 12) }
    else if (r.status === 404) state = 'not_created'
    else state = 'unknown'
  } catch { state = 'unknown' }
  return { slug: spec.slug, name: spec.name, category: spec.category, replaces: spec.replaces, image: spec.image, port: spec.port, needs: spec.needs || [], note: spec.note || '', state, url: state === 'running' ? `http://localhost:${hostPort(spec)}` : null, containerId: id }
}
async function statusAll() { return Promise.all(REGISTRY.map(statusOf)) }

async function launch(slug, envOverride) {
  const spec = getTool(slug); if (!spec) return { ok: false, message: 'Unknown tool.' }
  if (!(await available())) return { ok: false, message: 'Docker is not connected on this host — mount /var/run/docker.sock into the app to launch tools.' }
  const name = containerName(slug)
  const url = `http://localhost:${hostPort(spec)}`
  const existing = await req('GET', `/containers/${name}/json`)
  if (existing.status === 200) { await req('POST', `/containers/${name}/start`); return { ok: true, message: `${spec.name} started.`, url } }
  // 1) private network  2) the databases this tool needs  3) the tool itself
  await ensureNetwork()
  for (const t of spec.needs || []) { if (!(await ensureDep(t))) return { ok: false, message: `Could not start dependency: ${t}.` } }
  const pull = await req('POST', `/images/create?fromImage=${encodeURIComponent(spec.image)}`)
  if (pull.status >= 400) return { ok: false, message: `Could not pull image ${spec.image}.` }
  const env = Object.assign({}, depEnv(spec.needs), PER_TOOL[slug] || {}, spec.env || {}, envOverride || {})
  const config = {
    Image: spec.image,
    Env: Object.keys(env).map((k) => `${k}=${env[k]}`),
    Labels: { 'com.likeaking.tool': slug, 'com.likeaking.managed': 'true' },
    ExposedPorts: { [`${spec.port}/tcp`]: {} },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' }, NetworkMode: NETWORK, PortBindings: { [`${spec.port}/tcp`]: [{ HostPort: String(hostPort(spec)) }] }, Binds: spec.volumes || [] },
  }
  const created = await req('POST', `/containers/create?name=${name}`, config)
  if (created.status >= 400) return { ok: false, message: (created.body && created.body.message) || 'Create failed.' }
  const started = await req('POST', `/containers/${name}/start`)
  if (started.status >= 400 && started.status !== 304) return { ok: false, message: (started.body && started.body.message) || 'Start failed.' }
  return { ok: true, message: `${spec.name} launched on port ${hostPort(spec)}${(spec.needs || []).length ? ' with its database' : ''}.`, url }
}
async function stop(slug) { const s = getTool(slug); if (!s) return { ok: false }; const r = await req('POST', `/containers/${containerName(slug)}/stop?t=10`); return { ok: r.status < 400 || r.status === 304, message: r.status < 400 ? `${s.name} stopped.` : 'Stop failed.' } }
async function restart(slug) { const s = getTool(slug); if (!s) return { ok: false }; const r = await req('POST', `/containers/${containerName(slug)}/restart?t=10`); return { ok: r.status < 400, message: r.status < 400 ? `${s.name} restarted.` : 'Restart failed.' } }
async function remove(slug) { const s = getTool(slug); if (!s) return { ok: false }; const r = await req('DELETE', `/containers/${containerName(slug)}?force=1&v=0`); return { ok: r.status < 400 || r.status === 404, message: r.status < 400 ? `${s.name} removed.` : 'Remove failed.' } }
async function logs(slug) { const r = await req('GET', `/containers/${containerName(slug)}/logs?stdout=1&stderr=1&tail=200`); return String(r.body || '').replace(/[\x00-\x08\x0e-\x1f]/g, '') }

module.exports = { REGISTRY, available, statusAll, launch, stop, restart, remove, logs }
