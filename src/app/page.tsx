import VaultDashboard from "@/components/vault-dashboard";
import { getVaultSnapshot } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { assets, categories, aliases } = await getVaultSnapshot();
  return <VaultDashboard initialAssets={assets} initialCategories={categories} initialAliases={aliases} />;
}
