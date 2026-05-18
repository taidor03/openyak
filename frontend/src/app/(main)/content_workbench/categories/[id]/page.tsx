import { EditCategoryClient } from "./edit-client";

export async function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditCategoryPage() {
  return <EditCategoryClient />;
}
