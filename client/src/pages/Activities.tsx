import { useState } from 'react';
import { trpc } from '../lib/trpc';

export default function Activities() {
  const [farmId] = useState(1); // Replace with real farm ID
  const [workerId] = useState('550e8400-e29b-41d4-a716-446655440000'); // Replace with real user ID
  const [form, setForm] = useState({
    activity_type: '',
    description: '',
    duration_minutes: 0,
    location: '',
  });

  const logActivity = trpc.activities.log.useMutation({
    onSuccess: () => {
      alert('Activity logged!');
      setForm({ activity_type: '', description: '', duration_minutes: 0, location: '' });
    },
    onError: (error) => {
      alert('Error: ' + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logActivity.mutate({
      farm_id: farmId,
      worker_id: workerId,
      activity_type: form.activity_type,
      description: form.description,
      duration_minutes: form.duration_minutes,
      location: form.location,
    });
  };

  return (
    <div style={{ padding: '20px', maxWidth: '500px' }}>
      <h1>Log Activity</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <label>Activity Type:</label>
          <input
            type="text"
            value={form.activity_type}
            onChange={(e) => setForm({ ...form, activity_type: e.target.value })}
            placeholder="e.g., Planting, Watering"
            required
          />
        </div>
        <div>
          <label>Description:</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Details about the activity"
            rows={3}
          />
        </div>
        <div>
          <label>Duration (minutes):</label>
          <input
            type="number"
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label>Location:</label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Field name or location"
          />
        </div>
        <button type="submit" disabled={logActivity.isPending}>
          {logActivity.isPending ? 'Logging...' : 'Log Activity'}
        </button>
      </form>
    </div>
  );
}
