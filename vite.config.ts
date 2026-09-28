import { defineConfig, loadEnv, type Plugin } from 'vite'
import { handleLocalApi } from './scripts/local-api'

function localLinkApi(): Plugin {
  return {
    name: 'local-link-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleLocalApi(req, res).then((handled) => {
          if (!handled) next()
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(fileEnv)) {
    if (!process.env[key]) process.env[key] = value
  }
  const base = mode === 'production' ? process.env.VITE_BASE || '/' : '/'
  return {
    base,
    plugins: [localLinkApi()],
    server: { host: '127.0.0.1', port: 5173 },
    preview: { host: '127.0.0.1', port: 4173 },
  }
})
