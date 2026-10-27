# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.


```
studyhub
├─ eslint.config.js
├─ FIREBASE_SETUP.md
├─ firestore.rules
├─ index.html
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ public
│  ├─ favicon.svg
│  ├─ icon-192.png
│  ├─ icon-512.png
│  ├─ icon-maskable-512.png
│  ├─ manifest.webmanifest
│  └─ sw.js
├─ README.md
├─ src
│  ├─ Account.jsx
│  ├─ AdminPanel.jsx
│  ├─ App.jsx
│  ├─ assets
│  ├─ authErrors.js
│  ├─ AuthGate.jsx
│  ├─ BlockEditor.jsx
│  ├─ Dashboard.jsx
│  ├─ Database.jsx
│  ├─ firebase.js
│  ├─ gcal.js
│  ├─ Heatmap.jsx
│  ├─ Icons.jsx
│  ├─ iconUtils.js
│  ├─ IntegrationsSettings.jsx
│  ├─ main.jsx
│  ├─ Notes.jsx
│  ├─ PrivacyPolicy.jsx
│  ├─ Rails.jsx
│  ├─ Rewards.jsx
│  ├─ Roadmap.jsx
│  ├─ RoadmapShare.jsx
│  ├─ ROADMAP_FEATURES.md
│  ├─ Settings.jsx
│  ├─ shared.js
│  ├─ sound.js
│  ├─ SoundSettings.jsx
│  ├─ StudyGroup.jsx
│  ├─ sync.js
│  ├─ todoActions.js
│  └─ TodoTools.jsx
└─ vite.config.js

```