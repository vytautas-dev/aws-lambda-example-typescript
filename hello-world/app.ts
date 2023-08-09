import { APIGatewayProxyResult } from 'aws-lambda';
import * as fs from 'fs/promises';
import { S3 } from 'aws-sdk';
import { canBeConvertedToPDF, convertTo } from '@shelf/aws-lambda-libreoffice';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { TEventInput } from './types';

const S3client = new S3({
    credentials: {
        accessKeyId: 'Q3AM3UQ867SPQQA43P2F',
        secretAccessKey: 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG',
    },
    endpoint: 'play.min.io',
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    correctClockSkew: true,
});

const createException = (statusCode: number, message: string) => {
    return {
        statusCode,
        body: JSON.stringify({
            message,
        }),
    };
};

export const lambdaHandler = async (event: TEventInput): Promise<APIGatewayProxyResult> => {
    try {
        const { document, fileID, templateBody, bucketName } = event;

        console.log('document.dataToFill', JSON.stringify(document.dataToFill));

        //zip the content
        const zip = new PizZip(Buffer.from(templateBody, 'base64'));

        // fill the file
        const doc = new Docxtemplater(zip, {
            delimiters: {
                start: '{{',
                end: '}}',
            },
            paragraphLoop: true,
            linebreaks: true,
            nullGetter() {
                return '';
            },
        });

        doc.render({ ...document.dataToFill });

        const buf = doc.getZip().generate({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });

        await fs.writeFile(`../../tmp/${fileID}`, buf);
        console.log(`<----- File filled and saved as ${fileID} ----->`);

        if (!canBeConvertedToPDF(fileID)) {
            console.log("<----- Can't convert file to PDF ----->");
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "Can't convert file to PDF",
                }),
            };
        }

        await convertTo(fileID, 'pdf');
        console.log('<----- File converted to PDF ----->');

        const outputPDF = await fs.readFile(`../../tmp/${fileID}.pdf`);

        const outputConfig = {
            Key: `${fileID}.pdf`,
            Bucket: bucketName,
            Body: outputPDF,
        };

        await S3client.putObject(outputConfig)
            .promise()
            .then(() => {
                console.log('PDF file uploaded successfully.');
            })
            .catch((err) => {
                console.log('err: ', err);
                throw err;
            });

        const outputFileWithExtension = fileID + document.extension;

        return {
            statusCode: 200,
            body: JSON.stringify({
                function: 'Filler',
                message: `File converted and saved successfully, converted file: ${outputFileWithExtension}`,
                fileName: outputFileWithExtension,
            }),
            headers: { 'content-type': 'application/json' },
        };
    } catch (err) {
        console.log(err);
        return createException(500, 'Internal Server Error');
    }
};
