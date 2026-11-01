class ApplicationError(Exception):
    pass


class DomainError(ApplicationError):
    pass


class InfrastructureError(Exception):
    pass
