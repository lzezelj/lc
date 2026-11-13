import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "../../auth";
import { ownerSession } from "../../server/owner";
import { AdminDashboard } from "./dashboard";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  if (!(await auth())) redirect("/login");
  if (!(await ownerSession()))
    return (
      <main className="adminDenied">
        <h1>Access denied</h1>
        <p>This dashboard is restricted to the configured application owner.</p>
        <Link href="/">Return to LZRelay</Link>
      </main>
    );
  return <AdminDashboard />;
}
