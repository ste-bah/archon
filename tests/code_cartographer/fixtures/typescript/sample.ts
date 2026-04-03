import { Router, Request, Response } from 'express';
import type { Config } from './config';
import { UserService } from './services/user.service';
import * as utils from '../shared/utils';
import defaultExport from './defaults';

export interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
}

export type UserId = string | number;

export const API_VERSION = '2.0';

export class ApiController {
  private router: Router;
  private userService: UserService;

  constructor(config: Config) {
    this.router = Router();
    this.userService = new UserService(config);
  }

  async getUser(req: Request, res: Response): Promise<void> {
    const user = await this.userService.findById(req.params.id);
    res.json({ data: user, status: 200 });
  }

  private handleError(error: Error): ApiResponse<null> {
    return { data: null, status: 500, message: error.message };
  }
}

export function createRouter(config: Config): Router {
  const controller = new ApiController(config);
  return controller['router'];
}

export default ApiController;
