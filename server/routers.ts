import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { db } from './db';

const t = initTRPC.create();

// Define input validation schemas
const createTaskSchema = z.object({
  farm_id: z.number(),
  assigned_to: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  due_date: z.string(),
});

const updateTaskStatusSchema = z.object({
  taskId: z.number(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

const logActivitySchema = z.object({
  farm_id: z.number(),
  worker_id: z.string().uuid(),
  activity_type: z.string().min(1, 'Activity type is required'),
  description: z.string().optional(),
  duration_minutes: z.number().optional(),
  location: z.string().optional(),
});

// Create routers
export const appRouter = t.router({
  // Task procedures
  tasks: t.router({
    // Get all tasks for a worker
    getByWorker: t.procedure
      .input(z.object({ workerId: z.string().uuid() }))
      .query(async ({ input }) => {
        try {
          return await db.getTasksByWorker(input.workerId);
        } catch (error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch tasks',
          });
        }
      }),

    // Create a new task
    create: t.procedure
      .input(createTaskSchema)
      .mutation(async ({ input }) => {
        try {
          return await db.createTask(input);
        } catch (error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create task',
          });
        }
      }),

    // Update task status
    updateStatus: t.procedure
      .input(updateTaskStatusSchema)
      .mutation(async ({ input }) => {
        try {
          return await db.updateTaskStatus(input.taskId, input.status);
        } catch (error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update task',
          });
        }
      }),
  }),

  // Farm procedures
  farms: t.router({
    // Get all farms for a manager
    getByManager: t.procedure
      .input(z.object({ managerId: z.string().uuid() }))
      .query(async ({ input }) => {
        try {
          return await db.getFarmsByManager(input.managerId);
        } catch (error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch farms',
          });
        }
      }),
  }),

  // Activity procedures
  activities: t.router({
    // Log an activity
    log: t.procedure
      .input(logActivitySchema)
      .mutation(async ({ input }) => {
        try {
          return await db.logActivity(input);
        } catch (error) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to log activity',
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
