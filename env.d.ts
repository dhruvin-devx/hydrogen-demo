/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  interface Env {
    PUBLIC_STORE_DOMAIN: string;
    REVIEW_API_URL: string;
    REVIEW_API_KEY: string;
    SHOPIFY_ADMIN_API_TOKEN: string;
  }
}
