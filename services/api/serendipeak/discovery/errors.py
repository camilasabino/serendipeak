from serendipeak.errors import ApplicationError


class NoEligibleMountains(ApplicationError):
    def __init__(self):
        super().__init__("no active mountain can be discovered")
