// /workspace redirects to / — the workstation is now the root dashboard.
import { redirect } from 'next/navigation';

export default function WorkspacePage() {
  redirect('/');
}
