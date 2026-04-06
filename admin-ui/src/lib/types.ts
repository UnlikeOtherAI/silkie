export interface Device {
  id: string;
  hostname: string;
  status: string;
  overlay_ip: string;
  os_platform: string;
  os_arch: string;
  agent_version: string;
  last_seen_at: string;
  wg_public_key: string;
}

export interface Session {
  id: string;
  status: string;
  requester_device_id: string;
  target_device_id: string;
  requested_action: string;
  created_at: string;
  expires_at: string;
  closed_at?: string;
}

export interface Service {
  id: string;
  device_id: string;
  device_hostname: string;
  name: string;
  protocol: string;
  bind_address: string;
  port: number;
  health: string;
}

export interface AuditEvent {
  event_uuid: string;
  actor_user_id: string;
  actor_device_id: string;
  action: string;
  outcome: string;
  target_table: string;
  target_id: string;
  remote_ip: string;
  user_agent: string;
  occurred_at: string;
}

export interface SystemInfo {
  version: string;
  overlay_cidr: string;
  turn_configured: boolean;
  turn_host: string;
  turn_port: number;
  opa_configured: boolean;
  redis_configured: boolean;
  active_devices: number;
  active_sessions: number;
}
