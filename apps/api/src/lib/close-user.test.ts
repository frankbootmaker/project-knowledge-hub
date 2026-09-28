import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { AppError } from '@project-knowledge-hub/domain';
import type { Database } from '@project-knowledge-hub/database';
import { purgeUserAccount } from './close-user.js';

const systemUser = {
  id: 'system-user',
  email: 'qa@example.com',
  displayName: 'QA',
  userType: 'system',
  isSystemAdmin: false,
  status: 'active',
};

function mockDb(ownsRows: boolean) {
  const deletes: string[] = [];
  const select = () => {
    let rows: unknown[] = [];
    const promise = () => Promise.resolve(rows);
    const api = {
      from(table: object) {
        const name = getTableName(table as never);
        if (name === 'users') rows = [systemUser];
        else rows = ownsRows ? [{ id: 'owned-row' }] : [];
        return api;
      },
      where() {
        return api;
      },
      limit() {
        return promise();
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (error: unknown) => unknown,
      ) {
        return promise().then(resolve, reject);
      },
    };
    return api;
  };
  const db = {
    select,
    update() {
      return {
        set() {
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete(table: object) {
      return {
        where() {
          deletes.push(getTableName(table as never));
          return {
            returning() {
              return Promise.resolve([
                {
                  id: systemUser.id,
                  email: systemUser.email,
                  displayName: systemUser.displayName,
                },
              ]);
            },
          };
        },
      };
    },
  };
  return { deletes, database: { db } as unknown as Database };
}

describe('purgeUserAccount system user', () => {
  it('refuses a hard delete while the system user still owns rows', async () => {
    const { deletes, database } = mockDb(true);
    await expect(
      purgeUserAccount(database, {
        userId: systemUser.id,
        avatarUploadDir: '/tmp/avatars-missing',
        appEnv: 'test',
      }),
    ).rejects.toMatchObject({
      code: 'SYSTEM_USER_PURGE_REQUIRED',
      statusCode: 409,
    });
    try {
      await purgeUserAccount(database, {
        userId: systemUser.id,
        avatarUploadDir: '/tmp/avatars-missing',
        appEnv: 'test',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message.toLowerCase()).toContain('purge first');
    }
    expect(deletes).toEqual([]);
  });
});
