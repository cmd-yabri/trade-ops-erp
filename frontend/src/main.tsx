import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Fonts are bundled so the app looks the same on a PC with no internet.
import "@fontsource/cairo/arabic-400.css";
import "@fontsource/cairo/arabic-500.css";
import "@fontsource/cairo/arabic-600.css";
import "@fontsource/cairo/arabic-700.css";
import "@fontsource/cairo/latin-400.css";
import "@fontsource/cairo/latin-500.css";
import "@fontsource/cairo/latin-600.css";
import "@fontsource/cairo/latin-700.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
