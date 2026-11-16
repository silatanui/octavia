from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.core.security import get_password_hash
from app.models.org import Department, ProductionLine, Site
from app.models.product import Product
from app.models.shift import Shift
from app.models.user import Role, User
from app.schemas.common import (
    DepartmentCreate,
    DepartmentOut,
    LineCreate,
    LineOut,
    ProductCreate,
    ProductOut,
    RoleOut,
    ShiftCreate,
    ShiftOut,
    SiteCreate,
    SiteOut,
    UserCreate,
    UserOut,
)
from app.services.audit import log_action

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/sites", response_model=list[SiteOut])
def list_sites(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return list(db.scalars(select(Site)).all())


@router.post("/sites", response_model=SiteOut)
def create_site(
    payload: SiteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator")),
):
    site = Site(**payload.model_dump())
    db.add(site)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="site", entity_id=site.id)
    db.commit()
    db.refresh(site)
    return site


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    site_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Department)
    if site_id:
        q = q.where(Department.site_id == site_id)
    return list(db.scalars(q).all())


@router.post("/departments", response_model=DepartmentOut)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator")),
):
    dept = Department(**payload.model_dump())
    db.add(dept)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="department", entity_id=dept.id)
    db.commit()
    db.refresh(dept)
    return dept


@router.get("/lines", response_model=list[LineOut])
def list_lines(
    department_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(ProductionLine)
    if department_id:
        q = q.where(ProductionLine.department_id == department_id)
    return list(db.scalars(q).all())


@router.post("/lines", response_model=LineOut)
def create_line(
    payload: LineCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator")),
):
    line = ProductionLine(**payload.model_dump())
    db.add(line)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="production_line", entity_id=line.id)
    db.commit()
    db.refresh(line)
    return line


@router.get("/shifts", response_model=list[ShiftOut])
def list_shifts(
    site_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Shift)
    if site_id:
        q = q.where(Shift.site_id == site_id)
    shifts = list(db.scalars(q).all())
    return [
        ShiftOut(
            id=s.id,
            site_id=s.site_id,
            shift_name=s.shift_name,
            start_time=s.start_time.strftime("%H:%M:%S"),
            end_time=s.end_time.strftime("%H:%M:%S"),
        )
        for s in shifts
    ]


@router.post("/shifts", response_model=ShiftOut)
def create_shift(
    payload: ShiftCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator")),
):
    start = datetime.strptime(payload.start_time, "%H:%M:%S").time() if len(payload.start_time) > 5 else datetime.strptime(payload.start_time, "%H:%M").time()
    end = datetime.strptime(payload.end_time, "%H:%M:%S").time() if len(payload.end_time) > 5 else datetime.strptime(payload.end_time, "%H:%M").time()
    shift = Shift(site_id=payload.site_id, shift_name=payload.shift_name, start_time=start, end_time=end)
    db.add(shift)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="shift", entity_id=shift.id)
    db.commit()
    db.refresh(shift)
    return ShiftOut(
        id=shift.id,
        site_id=shift.site_id,
        shift_name=shift.shift_name,
        start_time=shift.start_time.strftime("%H:%M:%S"),
        end_time=shift.end_time.strftime("%H:%M:%S"),
    )


@router.get("/products", response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return list(db.scalars(select(Product)).all())


@router.post("/products", response_model=ProductOut)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator", "Production Manager")),
):
    product = Product(**payload.model_dump())
    db.add(product)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="product", entity_id=product.id)
    db.commit()
    db.refresh(product)
    return product


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return list(db.scalars(select(Role)).all())


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("Administrator")),
):
    users = list(db.scalars(select(User).options(joinedload(User.role))).unique().all())
    return [
        UserOut(
            id=u.id,
            name=u.name,
            email=u.email,
            status=u.status,
            role_id=u.role_id,
            role_name=u.role.role_name if u.role else None,
        )
        for u in users
    ]


@router.post("/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator")),
):
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(400, "Email already registered")
    new_user = User(
        name=payload.name,
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        role_id=payload.role_id,
        status=payload.status,
    )
    db.add(new_user)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="user", entity_id=new_user.id)
    db.commit()
    new_user = db.scalar(select(User).options(joinedload(User.role)).where(User.id == new_user.id))
    return UserOut(
        id=new_user.id,
        name=new_user.name,
        email=new_user.email,
        status=new_user.status,
        role_id=new_user.role_id,
        role_name=new_user.role.role_name if new_user.role else None,
    )


@router.get("/overview")
def org_overview(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sites = list(db.scalars(select(Site)).all())
    departments = list(db.scalars(select(Department)).all())
    lines = list(db.scalars(select(ProductionLine)).all())
    return {
        "sites": sites,
        "departments": departments,
        "lines": lines,
    }
