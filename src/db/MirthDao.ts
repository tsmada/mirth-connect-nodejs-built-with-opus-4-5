/**
 * Data Access Object for core Mirth tables
 *
 * Tables: CHANNEL, CONFIGURATION, PERSON, CODE_TEMPLATE, etc.
 *
 * Reference: ~/Projects/connect/server/dbconf/mysql/mysql-database.sql
 */

import { RowDataPacket } from 'mysql2/promise';
import { query, execute, transaction } from './pool.js';

// Channel table interfaces
export interface ChannelRow extends RowDataPacket {
  ID: string;
  NAME: string;
  REVISION: number;
  CHANNEL: string; // XML serialized channel
}

export interface ConfigurationRow extends RowDataPacket {
  CATEGORY: string;
  NAME: string;
  VALUE: string;
}

export interface PersonRow extends RowDataPacket {
  ID: number;
  USERNAME: string;
  PASSWORD: string | null; // Hashed password from PERSON_PASSWORD table
  SALT: string | null; // Not used in Mirth 3.9 - password includes salt
  ROLE: string | null; // User role (admin, manager, operator, monitor)
  FIRSTNAME: string;
  LASTNAME: string;
  ORGANIZATION: string;
  EMAIL: string;
  PHONENUMBER: string;
  DESCRIPTION: string;
  INDUSTRY: string;
  LOGGED_IN: number;
  LAST_LOGIN: Date;
  GRACE_PERIOD_START: Date;
  STRIKE_COUNT: number;
}

export interface CodeTemplateRow extends RowDataPacket {
  ID: string;
  NAME: string;
  REVISION: number;
  CODE_TEMPLATE: string; // XML serialized
}

export interface CodeTemplateLibraryRow extends RowDataPacket {
  ID: string;
  NAME: string;
  REVISION: number;
  LIBRARY: string; // XML serialized
}

/**
 * Get all channels
 */
export async function getChannels(): Promise<ChannelRow[]> {
  return query<ChannelRow>('SELECT ID, NAME, REVISION, CHANNEL FROM CHANNEL');
}

/**
 * Get a channel by ID
 */
export async function getChannelById(id: string): Promise<ChannelRow | null> {
  const rows = await query<ChannelRow>(
    'SELECT ID, NAME, REVISION, CHANNEL FROM CHANNEL WHERE ID = :id',
    { id }
  );
  return rows[0] ?? null;
}

/**
 * Get a channel by name
 */
export async function getChannelByName(name: string): Promise<ChannelRow | null> {
  const rows = await query<ChannelRow>(
    'SELECT ID, NAME, REVISION, CHANNEL FROM CHANNEL WHERE NAME = :name',
    { name }
  );
  return rows[0] ?? null;
}

/**
 * Insert or update a channel
 */
export async function upsertChannel(
  id: string,
  name: string,
  channelXml: string,
  revision: number
): Promise<void> {
  await execute(
    `INSERT INTO CHANNEL (ID, NAME, REVISION, CHANNEL)
     VALUES (:id, :name, :revision, :channelXml)
     ON DUPLICATE KEY UPDATE NAME = :name, REVISION = :revision, CHANNEL = :channelXml`,
    { id, name, revision, channelXml }
  );
}

/**
 * Delete a channel
 */
export async function deleteChannel(id: string): Promise<void> {
  await execute('DELETE FROM CHANNEL WHERE ID = :id', { id });
}

/**
 * Get a configuration value
 */
export async function getConfiguration(category: string, name: string): Promise<string | null> {
  const rows = await query<ConfigurationRow>(
    'SELECT VALUE FROM CONFIGURATION WHERE CATEGORY = :category AND NAME = :name',
    { category, name }
  );
  return rows[0]?.VALUE ?? null;
}

/**
 * Set a configuration value
 */
export async function setConfiguration(
  category: string,
  name: string,
  value: string
): Promise<void> {
  await execute(
    `INSERT INTO CONFIGURATION (CATEGORY, NAME, VALUE)
     VALUES (:category, :name, :value)
     ON DUPLICATE KEY UPDATE VALUE = :value`,
    { category, name, value }
  );
}

/**
 * Get all configuration values for a category
 */
export async function getConfigurationByCategory(category: string): Promise<ConfigurationRow[]> {
  return query<ConfigurationRow>(
    'SELECT CATEGORY, NAME, VALUE FROM CONFIGURATION WHERE CATEGORY = :category',
    { category }
  );
}

/**
 * Get a user by username (including password from PERSON_PASSWORD table)
 */
export async function getPersonByUsername(username: string): Promise<PersonRow | null> {
  const rows = await query<PersonRow>(
    `SELECT p.*, pp.PASSWORD
     FROM PERSON p
     LEFT JOIN PERSON_PASSWORD pp ON p.ID = pp.PERSON_ID
     WHERE p.USERNAME = :username`,
    { username }
  );
  return rows[0] ?? null;
}

/**
 * Get a user by ID
 */
export async function getPersonById(id: number): Promise<PersonRow | null> {
  const rows = await query<PersonRow>('SELECT * FROM PERSON WHERE ID = :id', { id });
  return rows[0] ?? null;
}

/**
 * Update user login status
 */
export async function updatePersonLoginStatus(id: number, loggedIn: boolean): Promise<void> {
  await execute(`UPDATE PERSON SET LOGGED_IN = :loggedIn, LAST_LOGIN = NOW() WHERE ID = :id`, {
    id,
    loggedIn: loggedIn ? 1 : 0,
  });
}

/**
 * Get all users
 */
export async function getAllPersons(): Promise<PersonRow[]> {
  return query<PersonRow>('SELECT * FROM PERSON');
}

/**
 * Create a new user (Mirth 3.x schema - password in separate table)
 */
export async function createPerson(person: {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  organization: string;
  email: string;
  phoneNumber: string;
  description: string;
  industry: string;
  role?: string;
}): Promise<number> {
  // Insert into PERSON table (no password column)
  const role = person.role || 'monitor'; // Default to least-privilege for new users
  const result = await execute(
    `INSERT INTO PERSON (USERNAME, FIRSTNAME, LASTNAME, ORGANIZATION, EMAIL, PHONENUMBER, DESCRIPTION, INDUSTRY, ROLE, LOGGED_IN, STRIKE_COUNT)
     VALUES (:username, :firstName, :lastName, :organization, :email, :phoneNumber, :description, :industry, :role, 0, 0)`,
    { ...person, role }
  );

  const personId = result.insertId;

  // Insert password into PERSON_PASSWORD table
  await execute(
    `INSERT INTO PERSON_PASSWORD (PERSON_ID, PASSWORD, PASSWORD_DATE) VALUES (:personId, :password, NOW())`,
    { personId, password: person.password }
  );

  return personId;
}

/**
 * Update a user
 */
export async function updatePerson(
  id: number,
  updates: Partial<{
    firstName: string;
    lastName: string;
    organization: string;
    email: string;
    phoneNumber: string;
    description: string;
    industry: string;
    role: string;
  }>
): Promise<void> {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

  if (updates.firstName !== undefined) {
    fields.push('FIRSTNAME = :firstName');
    params.firstName = updates.firstName;
  }
  if (updates.lastName !== undefined) {
    fields.push('LASTNAME = :lastName');
    params.lastName = updates.lastName;
  }
  if (updates.organization !== undefined) {
    fields.push('ORGANIZATION = :organization');
    params.organization = updates.organization;
  }
  if (updates.email !== undefined) {
    fields.push('EMAIL = :email');
    params.email = updates.email;
  }
  if (updates.phoneNumber !== undefined) {
    fields.push('PHONENUMBER = :phoneNumber');
    params.phoneNumber = updates.phoneNumber;
  }
  if (updates.description !== undefined) {
    fields.push('DESCRIPTION = :description');
    params.description = updates.description;
  }
  if (updates.industry !== undefined) {
    fields.push('INDUSTRY = :industry');
    params.industry = updates.industry;
  }
  if (updates.role !== undefined) {
    fields.push('ROLE = :role');
    params.role = updates.role;
  }

  if (fields.length > 0) {
    await execute(`UPDATE PERSON SET ${fields.join(', ')} WHERE ID = :id`, params);
  }
}

/**
 * Delete a user
 */
export async function deletePerson(id: number): Promise<void> {
  await execute('DELETE FROM PERSON WHERE ID = :id', { id });
}

/**
 * Update user password (stored in PERSON_PASSWORD table in Mirth 3.x)
 */
export async function updatePersonPassword(id: number, password: string): Promise<void> {
  await execute(
    `INSERT INTO PERSON_PASSWORD (PERSON_ID, PASSWORD, PASSWORD_DATE)
     VALUES (:id, :password, NOW())
     ON DUPLICATE KEY UPDATE PASSWORD = :password, PASSWORD_DATE = NOW()`,
    { id, password }
  );
}

/**
 * Get user preferences
 */
export async function getPersonPreferences(userId: number): Promise<Record<string, string>> {
  const rows = await query<ConfigurationRow>(
    'SELECT NAME, VALUE FROM PERSON_PREFERENCE WHERE PERSON_ID = :userId',
    { userId }
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.NAME] = row.VALUE;
  }
  return result;
}

/**
 * Set user preferences
 */
export async function setPersonPreferences(
  userId: number,
  preferences: Record<string, string>
): Promise<void> {
  for (const [name, value] of Object.entries(preferences)) {
    await execute(
      `INSERT INTO PERSON_PREFERENCE (PERSON_ID, NAME, VALUE)
       VALUES (:userId, :name, :value)
       ON DUPLICATE KEY UPDATE VALUE = :value`,
      { userId, name, value }
    );
  }
}

/**
 * Get all code templates
 */
export async function getCodeTemplates(): Promise<CodeTemplateRow[]> {
  return query<CodeTemplateRow>('SELECT ID, NAME, REVISION, CODE_TEMPLATE FROM CODE_TEMPLATE');
}

/**
 * Get code templates by IDs
 */
export async function getCodeTemplatesByIds(ids: string[]): Promise<CodeTemplateRow[]> {
  if (ids.length === 0) {
    return [];
  }
  // Use parameterized IN clause
  const placeholders = ids.map((_, i) => `:id${i}`).join(', ');
  const params: Record<string, string> = {};
  ids.forEach((id, i) => {
    params[`id${i}`] = id;
  });
  return query<CodeTemplateRow>(
    `SELECT ID, NAME, REVISION, CODE_TEMPLATE FROM CODE_TEMPLATE WHERE ID IN (${placeholders})`,
    params
  );
}

/**
 * Get a code template by ID
 */
export async function getCodeTemplateById(id: string): Promise<CodeTemplateRow | null> {
  const rows = await query<CodeTemplateRow>(
    'SELECT ID, NAME, REVISION, CODE_TEMPLATE FROM CODE_TEMPLATE WHERE ID = :id',
    { id }
  );
  return rows[0] ?? null;
}

/**
 * Insert or update a code template
 */
export async function upsertCodeTemplate(
  id: string,
  name: string,
  codeTemplateXml: string,
  revision: number
): Promise<void> {
  await execute(
    `INSERT INTO CODE_TEMPLATE (ID, NAME, REVISION, CODE_TEMPLATE)
     VALUES (:id, :name, :revision, :codeTemplateXml)
     ON DUPLICATE KEY UPDATE NAME = :name, REVISION = :revision, CODE_TEMPLATE = :codeTemplateXml`,
    { id, name, revision, codeTemplateXml }
  );
}

/**
 * Delete a code template
 */
export async function deleteCodeTemplate(id: string): Promise<void> {
  await execute('DELETE FROM CODE_TEMPLATE WHERE ID = :id', { id });
}

/**
 * Get all code template libraries
 */
export async function getCodeTemplateLibraries(): Promise<CodeTemplateLibraryRow[]> {
  return query<CodeTemplateLibraryRow>(
    'SELECT ID, NAME, REVISION, LIBRARY FROM CODE_TEMPLATE_LIBRARY'
  );
}

/**
 * Get code template libraries by IDs
 */
export async function getCodeTemplateLibrariesByIds(
  ids: string[]
): Promise<CodeTemplateLibraryRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map((_, i) => `:id${i}`).join(', ');
  const params: Record<string, string> = {};
  ids.forEach((id, i) => {
    params[`id${i}`] = id;
  });
  return query<CodeTemplateLibraryRow>(
    `SELECT ID, NAME, REVISION, LIBRARY FROM CODE_TEMPLATE_LIBRARY WHERE ID IN (${placeholders})`,
    params
  );
}

/**
 * Get a code template library by ID
 */
export async function getCodeTemplateLibraryById(
  id: string
): Promise<CodeTemplateLibraryRow | null> {
  const rows = await query<CodeTemplateLibraryRow>(
    'SELECT ID, NAME, REVISION, LIBRARY FROM CODE_TEMPLATE_LIBRARY WHERE ID = :id',
    { id }
  );
  return rows[0] ?? null;
}

/**
 * Insert or update a code template library
 */
export async function upsertCodeTemplateLibrary(
  id: string,
  name: string,
  libraryXml: string,
  revision: number
): Promise<void> {
  await execute(
    `INSERT INTO CODE_TEMPLATE_LIBRARY (ID, NAME, REVISION, LIBRARY)
     VALUES (:id, :name, :revision, :libraryXml)
     ON DUPLICATE KEY UPDATE NAME = :name, REVISION = :revision, LIBRARY = :libraryXml`,
    { id, name, revision, libraryXml }
  );
}

/**
 * Delete a code template library
 */
export async function deleteCodeTemplateLibrary(id: string): Promise<void> {
  await execute('DELETE FROM CODE_TEMPLATE_LIBRARY WHERE ID = :id', { id });
}

/**
 * Initialize database schema (for testing)
 * In production, Mirth Java creates the schema
 */
export async function initializeSchema(): Promise<void> {
  await transaction(async (connection) => {
    // This is a simplified version - full schema is in mysql-database.sql
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CHANNEL (
        ID VARCHAR(36) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL,
        REVISION INT NOT NULL DEFAULT 0,
        CHANNEL LONGTEXT NOT NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS CONFIGURATION (
        CATEGORY VARCHAR(255) NOT NULL,
        NAME VARCHAR(255) NOT NULL,
        VALUE LONGTEXT,
        PRIMARY KEY (CATEGORY, NAME)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS CODE_TEMPLATE (
        ID VARCHAR(36) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL,
        REVISION INT NOT NULL DEFAULT 0,
        CODE_TEMPLATE LONGTEXT NOT NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS CODE_TEMPLATE_LIBRARY (
        ID VARCHAR(255) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL UNIQUE,
        REVISION INT,
        LIBRARY LONGTEXT
      )
    `);
  });
}
