const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WriteJobSchema,
  requiredHeader,
} = require('../dist/lib/tenant-job-context');

const valid = {
  taskId: '17e63bdd-e2a5-488e-8a4f-b42a8ab364ea',
  tenantId: 'tenant-a',
  workflowId: 'workflow-a',
  commandId: 'command-a',
  idempotencyKey: 'idem-a',
  correlationId: 'corr-a',
  traceId: 'trace-a',
  authorityContext: {
    actorType: 'service',
    actorId: 'orchestrator',
    permissions: ['content:write'],
  },
};

test('complete tenant-owned writer job is accepted', () => {
  assert.equal(WriteJobSchema.parse(valid).tenantId, 'tenant-a');
});

for (const field of [
  'tenantId',
  'workflowId',
  'commandId',
  'idempotencyKey',
  'correlationId',
  'traceId',
  'authorityContext',
]) {
  test(`missing ${field} is rejected`, () => {
    assert.equal(WriteJobSchema.safeParse({ ...valid, [field]: undefined }).success, false);
  });
}

test('unknown tenant is rejected', () => {
  assert.equal(WriteJobSchema.safeParse({ ...valid, tenantId: '' }).success, false);
});

test('missing propagation header is rejected', () => {
  assert.throws(() => requiredHeader({}, 'x-workflow-id'), /missing_tenant_context/);
});

