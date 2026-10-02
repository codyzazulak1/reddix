import ReddixApp from "@/components/reddix-app";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ReddixApp />
      {children}
    </>
  );
}
