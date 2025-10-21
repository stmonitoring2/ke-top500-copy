// app/signin/page.tsx (SERVER)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = false; // also ok to use 0

import SignInClient from "./signin-client";

export default function SignInPage() {
  return <SignInClient />;
}
