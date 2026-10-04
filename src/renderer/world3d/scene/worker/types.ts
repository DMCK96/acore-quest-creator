// @ts-nocheck
import { RESPONSE_STATUS } from './const.js';

type WorkerRequest = {
  id: number;
  func: string;
  args: any[];
};

interface WorkerResponse {
  id: number;
  status: RESPONSE_STATUS;
  value: any;
}

export { WorkerRequest, WorkerResponse };
