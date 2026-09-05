/**
 * IMP-040 — Tasks, dependencies, checklists, comments barrel: the stable
 * public contract plus the selected adapter. Implementation modules
 * (./fixture, ./supabase) are internal — never import them from consumers.
 */
export { taskService } from './taskService';
export type {
  AddTaskDependencyInput,
  AddTaskDependencyResult,
  CreateTaskInput,
  RemoveTaskDependencyResult,
  TaskChecklistItemRecord,
  TaskCommentRecord,
  TaskDependencyRecord,
  TaskDetail,
  TaskListFilter,
  TaskRecord,
  TaskService,
  TaskStatus,
  TransitionTaskInput,
  TransitionTaskResult,
  UpdateTaskInput,
} from './types';
