from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

ROLE_HIERARCHY = {
    "Administrator": 100,
    "Production Manager": 80,
    "Production Supervisor": 60,
    "Maintenance User": 50,
    "Machine Operator": 40,
}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    user = db.get(User, int(payload["sub"]))
    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    return user


def require_roles(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        role_name = user.role.role_name if user.role else ""
        if role_name not in roles and role_name != "Administrator":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return checker


def require_min_role(min_role: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        role_name = user.role.role_name if user.role else ""
        if ROLE_HIERARCHY.get(role_name, 0) < ROLE_HIERARCHY.get(min_role, 999):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return checker
