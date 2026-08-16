/**
 * Where the API lives. Empty by default, which makes every request relative —
 * the browser talks to the same origin serving the page, so a deploy needs no
 * configuration at all. Set it only to point the app at a different backend.
 *
 * This file used to hold a chain, two contract addresses and a deployment
 * block, and the app rendered an explainer instead of a feed until all of them
 * were filled in. There is nothing left to configure.
 */
export const apiBaseUrl = process.env.NEXT_PUBLIC_PARLEY_API ?? "";
