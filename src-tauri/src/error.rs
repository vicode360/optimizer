use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Permissão insuficiente: {0}")]
    AdminRequired(String),

    #[error("Falha de I/O: {0}")]
    Io(#[from] std::io::Error),

    #[error("Falha de serialização: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Erro no sistema Windows: {0}")]
    WindowsApi(String),

    #[error("Backup inválido ou não encontrado: {0}")]
    BackupError(String),

    #[error("Operação inválida: {0}")]
    InvalidOperation(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
    pub detail: Option<String>,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::AdminRequired(_) => "ADMIN_REQUIRED",
            AppError::Io(_) => "IO_ERROR",
            AppError::Serde(_) => "SERDE_ERROR",
            AppError::WindowsApi(_) => "WINDOWS_API_ERROR",
            AppError::BackupError(_) => "BACKUP_ERROR",
            AppError::InvalidOperation(_) => "INVALID_OPERATION",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
            detail: None,
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
