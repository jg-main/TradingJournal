'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface TradeExitNotesCardProps {
  exitNotes: string | null;
  lesson: string | null;
}

export default function TradeExitNotesCard({ exitNotes, lesson }: TradeExitNotesCardProps) {
  if (!exitNotes && !lesson) return null;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {exitNotes && (
        <Card>
          <CardHeader>
            <CardTitle>Exit Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{exitNotes}</p>
          </CardContent>
        </Card>
      )}
      {lesson && (
        <Card>
          <CardHeader>
            <CardTitle>Lesson</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{lesson}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
