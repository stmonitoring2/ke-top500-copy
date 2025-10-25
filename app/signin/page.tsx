// app/signin/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import SignInForm from "@/components/SignInForm";

export default function SignInPage() {
  return (
    <main className="max-w-md mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-6">Sign in</h1>
      <SignInForm />
    </main>
  );
}
