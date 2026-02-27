import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ManualInvoiceEntry from "./ManualInvoiceEntry";
import SummaryPreview from "../components/invoices/SummaryPreview";

export default function NewInvoice() {
    return (
        <div className="flex flex-col space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Ingreso de Facturas</h1>
                <p className="text-muted-foreground mt-1">
                    Ingresa facturas de forma manual para conciliación bancaria.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Detalle Manual</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ManualInvoiceEntry embedded={true} />
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-1">
                    <SummaryPreview />
                </div>
            </div>
        </div>
    );
}
