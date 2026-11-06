import type { Metadata } from "next";
import CatBaseReview from "@/components/CatBaseReview";
import CatCreator from "@/components/CatCreator";

export const metadata: Metadata = {
  title: "猫咪捏脸 · 喵星",
  description: "选择无毛、短毛或长毛猫，调整脸型与被毛，在本机保存和导出模型。",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string; legacy?: string }>;
}) {
  const query = await searchParams;
  if (query.legacy !== "1" && query.compare !== "1") return <CatCreator />;
  return (
    <CatBaseReview
      showComparison={
        process.env.NODE_ENV === "development" && query.compare === "1"
      }
    />
  );
}
