# TradeOps - web interface

React 18 + TypeScript + Vite + Tailwind + shadcn/ui, Arabic (RTL). In the product it is compiled and
served by the Django backend inside the desktop window; see the repository `README.md` and `UPDATING.md`.

```
npm install        # once
npm run dev        # http://localhost:8080  (needs the API on http://127.0.0.1:8000)
npm run build      # production build into dist/ (build_exe.bat does this for you)
npm run lint
npx tsc --noEmit -p tsconfig.app.json
```

Where things live: `src/pages` (screens), `src/hooks` (React Query data hooks), `src/services` (API calls),
`src/lib` (API client, error messages, print helpers), `src/components` (layout and UI building blocks).
