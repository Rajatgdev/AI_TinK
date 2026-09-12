import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App";
import "./styles.css";

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const root = createRoot(document.getElementById("root")!);

if (!domain || !clientId || !audience) {
  root.render(<main><h1>Auth0 configuration required</h1><p>Add the VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, and VITE_AUTH0_AUDIENCE values to the root .env file, then restart the dashboard.</p></main>);
} else {
  root.render(
    <StrictMode>
      <Auth0Provider domain={domain} clientId={clientId} authorizationParams={{ redirect_uri: window.location.origin, audience }}>
        <App />
      </Auth0Provider>
    </StrictMode>,
  );
}
