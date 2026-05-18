import { EditBlogClient } from "./edit-client";

export async function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditBlogPage() {
  return <EditBlogClient />;
}
