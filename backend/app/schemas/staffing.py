from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

AssignmentRole = Literal["section_lead", "team_lead", "operator", "junior", "relief"]


class StaffAssignmentCreate(BaseModel):
    user_id: int
    work_date: date
    shift_id: int
    assignment_role: AssignmentRole
    production_line_id: int | None = None
    machine_id: int | None = None
    notes: str | None = Field(default=None, max_length=500)


class StaffAssignmentUpdate(BaseModel):
    assignment_role: AssignmentRole | None = None
    production_line_id: int | None = None
    machine_id: int | None = None
    notes: str | None = Field(default=None, max_length=500)
    clear_line: bool = False
    clear_machine: bool = False


class StaffAssignmentOut(ORMModel):
    id: int
    user_id: int
    user_name: str
    user_email: str | None = None
    user_role_name: str | None = None
    work_date: date
    shift_id: int
    shift_name: str | None = None
    assignment_role: str
    production_line_id: int | None = None
    line_name: str | None = None
    machine_id: int | None = None
    machine_code: str | None = None
    machine_name: str | None = None
    notes: str | None = None
    created_by: int | None = None
    created_at: datetime | None = None


class StaffingMachineSlot(BaseModel):
    machine_id: int
    machine_code: str
    machine_name: str
    status: str
    staff: list[StaffAssignmentOut]


class StaffingLineBlock(BaseModel):
    production_line_id: int
    line_name: str
    department_id: int
    department_name: str
    leads: list[StaffAssignmentOut]
    machines: list[StaffingMachineSlot]


class StaffingAvailableUser(BaseModel):
    id: int
    name: str
    email: str
    role_name: str | None = None


class StaffingBoard(BaseModel):
    work_date: date
    shift_id: int | None
    shift_name: str | None = None
    can_edit: bool
    available: list[StaffingAvailableUser]
    lines: list[StaffingLineBlock]
    unplaced: list[StaffAssignmentOut] = []


class StaffingOptions(BaseModel):
    users: list[StaffingAvailableUser]
    shifts: list[dict]
    departments: list[dict]
    lines: list[dict]
    machines: list[dict]
    roles: list[dict]
