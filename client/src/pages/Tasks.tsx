import { useState } from 'react';
import { trpc } from '../lib/trpc';

export default function Tasks( ) {
  // Replace this with a real user ID from your Supabase auth
  const [workerId] = useState('550e8400-e29b-41d4-a716-446655440000');
  
  // Fetch tasks using tRPC
  const { data: tasks, isLoading, error } = trpc.tasks.getByWorker.useQuery({
    workerId,
  });

  // Mutation for updating task status
  const updateStatus = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => {
      alert('Task updated!');
    },
  });

  if (isLoading) return <div style={{ padding: '20px' }}>Loading tasks...</div>;
  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error.message}</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h1>My Tasks</h1>
      {tasks && tasks.length > 0 ? (
        tasks.map((task) => (
          <div
            key={task.id}
            style={{
              border: '1px solid #ccc',
              padding: '15px',
              marginBottom: '10px',
              borderRadius: '8px',
            }}
          >
            <h3>{task.title}</h3>
            <p>{task.description}</p>
            <p>
              <strong>Status:</strong> {task.status} | <strong>Priority:</strong> {task.priority}
            </p>
            <button
              onClick={() =>
                updateStatus.mutate({
                  taskId: task.id,
                  status: 'completed',
                })
              }
              disabled={updateStatus.isPending}
            >
              {updateStatus.isPending ? 'Updating...' : 'Mark Complete'}
            </button>
          </div>
        ))
      ) : (
        <p>No tasks found</p>
      )}
    </div>
  );
}
