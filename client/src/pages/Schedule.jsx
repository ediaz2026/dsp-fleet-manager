import { useSearchParams } from 'react-router-dom';
import WeeklySchedule from './WeeklySchedule';
import DailySchedule from './DailySchedule';

export default function Schedule() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  if (tab === 'daily') return <DailySchedule />;
  return <WeeklySchedule />;
}
