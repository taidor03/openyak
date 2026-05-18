import { EditOutfitClient } from "./edit-client";

export async function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditOutfitPage() {
  return <EditOutfitClient />;
}
