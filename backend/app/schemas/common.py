from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict[str, Any]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORMModel):
    id: int
    name: str
    email: EmailStr
    status: str
    role_id: int
    role_name: str | None = None


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role_id: int
    status: str = "active"


class SiteOut(ORMModel):
    id: int
    site_name: str
    location: str | None = None
    timezone: str


class SiteCreate(BaseModel):
    site_name: str
    location: str | None = None
    timezone: str = "UTC"


class DepartmentOut(ORMModel):
    id: int
    site_id: int
    department_name: str


class DepartmentCreate(BaseModel):
    site_id: int
    department_name: str


class LineOut(ORMModel):
    id: int
    department_id: int
    line_name: str


class LineCreate(BaseModel):
    department_id: int
    line_name: str


class MachineOut(ORMModel):
    id: int
    production_line_id: int
    machine_code: str
    machine_name: str
    machine_type: str | None = None
    status: str
    active: bool
    last_update_at: datetime | None = None
    status_source: str
    line_name: str | None = None


class MachineCreate(BaseModel):
    production_line_id: int
    machine_code: str
    machine_name: str
    machine_type: str | None = None
    status: str = "Offline"
    active: bool = True


class MachineUpdate(BaseModel):
    machine_name: str | None = None
    machine_type: str | None = None
    status: str | None = None
    active: bool | None = None
    production_line_id: int | None = None


class ShiftOut(ORMModel):
    id: int
    site_id: int
    shift_name: str
    start_time: str
    end_time: str


class ShiftCreate(BaseModel):
    site_id: int
    shift_name: str
    start_time: str
    end_time: str


class ProductOut(ORMModel):
    id: int
    product_code: str
    product_name: str
    ideal_cycle_time: float
    unit_of_measure: str


class ProductCreate(BaseModel):
    product_code: str
    product_name: str
    ideal_cycle_time: float = 60
    unit_of_measure: str = "pcs"


class WorkOrderOut(ORMModel):
    id: int
    order_number: str
    product_id: int
    machine_id: int | None
    planned_quantity: float
    actual_quantity: float
    good_quantity: float
    rejected_quantity: float
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    actual_start: datetime | None = None
    actual_end: datetime | None = None
    customer_ref: str | None = None
    status: str
    notes: str | None = None
    product_name: str | None = None
    machine_name: str | None = None


class WorkOrderCreate(BaseModel):
    order_number: str
    product_id: int
    machine_id: int | None = None
    planned_quantity: float
    planned_start: datetime | None = None
    planned_end: datetime | None = None
    customer_ref: str | None = None
    status: str = "Planned"
    notes: str | None = None


class WorkOrderUpdate(BaseModel):
    machine_id: int | None = None
    planned_quantity: float | None = None
    actual_quantity: float | None = None
    good_quantity: float | None = None
    rejected_quantity: float | None = None
    status: str | None = None
    notes: str | None = None
    planned_end: datetime | None = None
    actual_start: datetime | None = None
    actual_end: datetime | None = None


class ProductionCreate(BaseModel):
    machine_id: int
    work_order_id: int | None = None
    shift_id: int | None = None
    recorded_at: datetime | None = None
    total_units: float
    good_units: float
    rejected_units: float = 0
    source: str = "manual"


class ProductionOut(ORMModel):
    id: int
    machine_id: int
    work_order_id: int | None
    shift_id: int | None
    recorded_at: datetime
    total_units: float
    good_units: float
    rejected_units: float
    source: str


class DowntimeCreate(BaseModel):
    machine_id: int
    work_order_id: int | None = None
    category_id: int | None = None
    started_at: datetime
    ended_at: datetime | None = None
    reason: str | None = None
    notes: str | None = None
    corrective_action: str | None = None
    status: str = "Open"


class DowntimeOut(ORMModel):
    id: int
    machine_id: int
    work_order_id: int | None
    category_id: int | None
    started_at: datetime
    ended_at: datetime | None
    reason: str | None
    status: str
    notes: str | None
    corrective_action: str | None
    category_name: str | None = None
    machine_name: str | None = None
    duration_minutes: float | None = None


class QualityCreate(BaseModel):
    machine_id: int
    work_order_id: int | None = None
    shift_id: int | None = None
    inspected_at: datetime | None = None
    good_units: float
    rejected_units: float
    defect_category: str | None = None
    notes: str | None = None
    corrective_action: str | None = None


class QualityOut(ORMModel):
    id: int
    machine_id: int
    work_order_id: int | None
    inspected_at: datetime
    good_units: float
    rejected_units: float
    defect_category: str | None
    notes: str | None
    corrective_action: str | None


class AlertUpdate(BaseModel):
    status: str | None = None
    assigned_to: int | None = None
    resolution_notes: str | None = None


class AlertOut(ORMModel):
    id: int
    machine_id: int | None
    alert_type: str
    severity: str
    message: str
    created_at: datetime
    assigned_to: int | None
    status: str
    resolved_at: datetime | None
    resolution_notes: str | None


class ShiftNoteCreate(BaseModel):
    site_id: int | None = None
    shift_id: int | None = None
    note_date: datetime | None = None
    content: str


class RoleOut(ORMModel):
    id: int
    role_name: str
