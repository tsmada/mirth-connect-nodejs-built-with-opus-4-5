/**
 * User model for API responses
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/User.java
 */

export interface User {
  id: number;
  username: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  email?: string;
  phoneNumber?: string;
  description?: string;
  industry?: string;
  lastLogin?: Date;
  gracePeriodStart?: Date;
  strikeCount?: number;
}

export interface LoginStatus {
  status: LoginStatusType;
  message?: string;
  updatedUsername?: string;
}

export enum LoginStatusType {
  SUCCESS = 'SUCCESS',
  SUCCESS_GRACE_PERIOD = 'SUCCESS_GRACE_PERIOD',
  FAIL = 'FAIL',
  FAIL_LOCKED_OUT = 'FAIL_LOCKED_OUT',
  FAIL_EXPIRED = 'FAIL_EXPIRED',
}

export function createLoginStatus(
  status: LoginStatusType,
  message?: string,
  updatedUsername?: string
): LoginStatus {
  return {
    status,
    message,
    updatedUsername,
  };
}
