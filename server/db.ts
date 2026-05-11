import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helper functions for common queries
export const db = {
  // Get all farms for a manager
  async getFarmsByManager(managerId: string) {
    const { data, error } = await supabase
      .from('farms')
      .select('*')
      .eq('manager_id', managerId);
    
    if (error) throw error;
    return data;
  },

  // Get all tasks for a worker
  async getTasksByWorker(workerId: string) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', workerId);
    
    if (error) throw error;
    return data;
  },

  // Create a new task
  async createTask(task: {
    farm_id: number;
    assigned_to: string;
    title: string;
    description?: string;
    priority: string;
    due_date: string;
  }) {
    const { data, error } = await supabase
      .from('tasks')
      .insert([task])
      .select();
    
    if (error) throw error;
    return data[0];
  },

  // Update task status
  async updateTaskStatus(taskId: number, status: string) {
    const { data, error } = await supabase
      .from('tasks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .select();
    
    if (error) throw error;
    return data[0];
  },

  // Log an activity
  async logActivity(activity: {
    farm_id: number;
    worker_id: string;
    activity_type: string;
    description?: string;
    duration_minutes?: number;
    location?: string;
  }) {
    const { data, error } = await supabase
      .from('activities')
      .insert([activity])
      .select();
    
    if (error) throw error;
    return data[0];
  },
};
