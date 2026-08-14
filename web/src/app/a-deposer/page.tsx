import { ADeposerView } from "@/components/a-deposer-view";

export const dynamic = "force-dynamic"; // la file dépend du tracker, qui bouge

export default function ADeposerPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">À déposer</h1>
      <p className="mt-1.5 text-sm text-muted">
        Les candidatures que tu as validées et que n8n n&apos;a pas pu envoyer : elles attendent un dépôt à la main sur
        le portail de l&apos;employeur, puis ta confirmation ici.
      </p>
      <div className="mt-6">
        <ADeposerView />
      </div>
    </div>
  );
}
