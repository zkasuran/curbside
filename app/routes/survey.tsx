// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { SurveyPage } from "@/components/survey/SurveyPage";

export function meta() {
  return [{ title: "Survey · Curbside" }];
}

export function HydrateFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-b-2 border-foreground" />
    </div>
  );
}

export default function SurveyRoute() {
  return <SurveyPage />;
}
