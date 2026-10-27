$targets = @(
    @{Name='Connector API'; Url='http://127.0.0.1:4310/health'},
    @{Name='PHU OpenMRS'; Url='http://127.0.0.1:18081/openmrs/ws/rest/v1/session'},
    @{Name='Hospital OpenMRS'; Url='http://127.0.0.1:18082/openmrs/ws/rest/v1/session'}
)
foreach ($target in $targets) {
    try {
        $response = Invoke-WebRequest -Uri $target.Url -TimeoutSec 8
        $json = $response.Content | ConvertFrom-Json -ErrorAction Stop
        $ready = ($json.status -eq 'ok') -or ($null -ne $json.authenticated)
        [PSCustomObject]@{Service=$target.Name; Ready=$ready; Detail='JSON endpoint responded'}
    } catch {
        [PSCustomObject]@{Service=$target.Name; Ready=$false; Detail='Initializing or unavailable'}
    }
}
