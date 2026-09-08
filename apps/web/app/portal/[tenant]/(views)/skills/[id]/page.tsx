import { SkillDetailPage } from "@/app/portal/components/skills/SkillDetailPage";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SkillDetailPage id={id} />;
}
