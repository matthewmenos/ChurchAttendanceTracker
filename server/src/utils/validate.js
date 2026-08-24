const { ApiError } = require('./errors');

function fail(message, field) {
  const err = new ApiError(400, message);
  if (field) err.details = [{ field, message }];
  throw err;
}

function vStr(body, field, { required = false, min = 0, max = 500, label } = {}) {
  const name = label || field;
  let value = body ? body[field] : undefined;
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(`${name} must be text.`, field);
  value = value.trim();
  if (required && !value) fail(`${name} is required.`, field);
  if (value && value.length < min) fail(`${name} must be at least ${min} characters.`, field);
  if (value && value.length > max) fail(`${name} must be at most ${max} characters.`, field);
  return value || null;
}

function vEmail(body, field, { required = false, max = 200 } = {}) {
  const raw = vStr(body, field, { required, max });
  if (raw && !/^\S+@\S+\.\S+$/.test(raw)) {
    fail('Enter a valid email address.', field);
  }
  return raw ? raw.toLowerCase() : null;
}

function vInt(body, field, { required = false, min, max, label } = {}) {
  const name = label || field;
  const value = body ? body[field] : undefined;
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${name} is required.`, field);
    return null;
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(num)) fail(`${name} must be a whole number.`, field);
  if (min !== undefined && num < min) fail(`${name} must be at least ${min}.`, field);
  if (max !== undefined && num > max) fail(`${name} must be at most ${max}.`, field);
  return num;
}

function vBool(body, field, { required = false, defaultVal = null } = {}) {
  const value = body ? body[field] : undefined;
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${field} is required.`, field);
    return defaultVal;
  }
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`${field} must be true or false.`, field);
  return null;
}

function vEnum(body, field, allowed, { required = false, label } = {}) {
  const name = label || field;
  const value = body ? body[field] : undefined;
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${name} is required.`, field);
    return null;
  }
  if (!allowed.includes(value)) fail(`${name} must be one of: ${allowed.join(', ')}.`, field);
  return value;
}

function vDate(body, field, { required = false, label } = {}) {
  const name = label || field;
  const raw = vStr(body, field, { required, max: 10 });
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail(`${name} must use YYYY-MM-DD format.`, field);
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) fail(`${name} is not a valid date.`, field);
  }
  return raw || null;
}

function vTime(body, field, { required = false, label } = {}) {
  const name = label || field;
  const raw = vStr(body, field, { required, max: 8 });
  if (raw && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(raw)) {
    fail(`${name} must use HH:MM format.`, field);
  }
  return raw || null;
}

module.exports = { vStr, vEmail, vInt, vBool, vEnum, vDate, vTime };