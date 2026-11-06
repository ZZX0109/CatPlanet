import { notFound } from "next/navigation";
import CatVisualValidation from "@/components/CatVisualValidation";

export default function Page() {
  if (process.env.NODE_ENV === "production" && process.env.CAT_MODELING_VALIDATION !== "1") notFound();
  return <CatVisualValidation />;
}
