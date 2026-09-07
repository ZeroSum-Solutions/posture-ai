import { redirect } from 'next/navigation'

/** Keep previously shared links pointed at the original application. */
export default function PreviousDemoLink() {
  redirect('/workouts')
}
