from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.analysis import build_analysis_overview

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/overview")
def analysis_overview(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return build_analysis_overview(db)
