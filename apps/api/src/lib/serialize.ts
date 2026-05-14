import type { User } from '@oneness/shared/prisma';

export type UserDTO = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  credits: number;
};

export function serializeUser(u: User): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatarKey,
    credits: u.credits,
  };
}
